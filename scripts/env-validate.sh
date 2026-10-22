#!/usr/bin/env bash
# scripts/env-validate.sh
#
# #106 — Environment promotion & configuration drift detection
#
# Validates environment variables and catches unsafe combinations before the
# app (or CI) proceeds. Exit code 1 = validation failed.
#
# Usage:
#   bash scripts/env-validate.sh           # reads from process environment
#   bash scripts/env-validate.sh .env.local # sources a specific file first
#
# Called by:
#   - .github/workflows/ci.yml (drift detection job)
#   - docker-entrypoint or Dockerfile CMD (startup guard)
#   - Developer pre-commit hook (optional)

set -euo pipefail

# ─── Optional: source a file if provided ──────────────────────────────────────
if [[ "${1:-}" != "" && -f "${1}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${1}"; set +a
fi

ERRORS=()
WARNINGS=()

# ─── Helper functions ──────────────────────────────────────────────────────────
require() {
  local var="$1"
  local label="${2:-$var}"
  if [[ -z "${!var:-}" ]]; then
    ERRORS+=("MISSING: ${label} is required but not set")
  fi
}

require_format() {
  local var="$1"
  local pattern="$2"
  local label="${3:-$var}"
  if [[ -n "${!var:-}" && ! "${!var}" =~ $pattern ]]; then
    ERRORS+=("INVALID FORMAT: ${label} does not match expected pattern (${pattern})")
  fi
}

unsafe_combo() {
  local condition="$1"
  local message="$2"
  if eval "$condition"; then
    ERRORS+=("UNSAFE COMBINATION: ${message}")
  fi
}

warn_combo() {
  local condition="$1"
  local message="$2"
  if eval "$condition"; then
    WARNINGS+=("WARNING: ${message}")
  fi
}

# ─── Required variables ────────────────────────────────────────────────────────
require NEXT_PUBLIC_APP_URL       "NEXT_PUBLIC_APP_URL"
require NEXTAUTH_URL              "NEXTAUTH_URL"
require NEXTAUTH_SECRET           "NEXTAUTH_SECRET"
require CSRF_SECRET               "CSRF_SECRET"
require DATABASE_URL              "DATABASE_URL"
require STELLAR_NETWORK           "STELLAR_NETWORK"
require STELLAR_HORIZON_URL       "STELLAR_HORIZON_URL"
require STELLAR_NETWORK_PASSPHRASE "STELLAR_NETWORK_PASSPHRASE"
require STELLAR_ESCROW_CONTRACT_ID "STELLAR_ESCROW_CONTRACT_ID"
require STELLAR_SERVER_SECRET_KEY  "STELLAR_SERVER_SECRET_KEY"
require STELLAR_RPC_URL           "STELLAR_RPC_URL"
require STELLAR_SERVER_PUBLIC_KEY  "STELLAR_SERVER_PUBLIC_KEY"
require USDC_ISSUER               "USDC_ISSUER"
require PAYSTACK_SECRET_KEY       "PAYSTACK_SECRET_KEY"
require STRIPE_SECRET_KEY         "STRIPE_SECRET_KEY"
require STRIPE_WEBHOOK_SECRET     "STRIPE_WEBHOOK_SECRET"
require TERMII_API_KEY            "TERMII_API_KEY"
require CRON_SECRET               "CRON_SECRET"
require REDIS_URL                 "REDIS_URL"
require CLOUDINARY_CLOUD_NAME     "CLOUDINARY_CLOUD_NAME"
require CLOUDINARY_API_KEY        "CLOUDINARY_API_KEY"
require CLOUDINARY_API_SECRET     "CLOUDINARY_API_SECRET"

# ─── Format checks ─────────────────────────────────────────────────────────────
require_format STELLAR_SERVER_SECRET_KEY "^S[A-Z0-9]{55}$" "STELLAR_SERVER_SECRET_KEY (must start with S, 56 chars)"
require_format STELLAR_SERVER_PUBLIC_KEY "^G[A-Z0-9]{55}$" "STELLAR_SERVER_PUBLIC_KEY (must start with G, 56 chars)"
require_format USDC_ISSUER              "^G[A-Z0-9]{55}$" "USDC_ISSUER (must start with G, 56 chars)"
require_format NEXT_PUBLIC_APP_URL      "^https?://"      "NEXT_PUBLIC_APP_URL (must be a URL)"
require_format NEXTAUTH_URL             "^https?://"      "NEXTAUTH_URL (must be a URL)"
require_format DATABASE_URL             "^postgresql?://" "DATABASE_URL (must be a postgres:// URL)"
require_format REDIS_URL                "^rediss?://"     "REDIS_URL (must be a redis:// URL)"

# Secret minimum length (≥32 chars)
for secret_var in NEXTAUTH_SECRET CSRF_SECRET CRON_SECRET; do
  val="${!secret_var:-}"
  if [[ -n "$val" && "${#val}" -lt 32 ]]; then
    ERRORS+=("TOO SHORT: ${secret_var} must be at least 32 characters (got ${#val})")
  fi
done

# Placeholder / example value detection
placeholder_pattern="(replace_with|your_|placeholder|changeme|XXXX|sk_test_placeholder|whsec_placeholder)"
for check_var in NEXTAUTH_SECRET CSRF_SECRET CRON_SECRET PAYSTACK_SECRET_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET TERMII_API_KEY; do
  val="${!check_var:-}"
  if [[ -n "$val" && "$val" =~ $placeholder_pattern ]]; then
    ERRORS+=("PLACEHOLDER: ${check_var} still contains a placeholder value — replace before deploying")
  fi
done

# ─── Unsafe environment combinations ──────────────────────────────────────────

# 1. Production app URL with testnet Stellar — would lock real money on testnet
unsafe_combo \
  '[[ "${NEXT_PUBLIC_APP_URL:-}" =~ ^https://lumigift\.(app|com)$ && "${STELLAR_NETWORK:-}" == "testnet" ]]' \
  "NEXT_PUBLIC_APP_URL points to production domain but STELLAR_NETWORK=testnet. Real money would lock on testnet."

# 2. Mainnet Stellar with testnet passphrase
unsafe_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${STELLAR_NETWORK_PASSPHRASE:-}" == *"Test SDF"* ]]' \
  "STELLAR_NETWORK=mainnet but STELLAR_NETWORK_PASSPHRASE is the testnet passphrase. Transactions will fail."

# 3. Mainnet Stellar with testnet Horizon URL
unsafe_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${STELLAR_HORIZON_URL:-}" == *"testnet"* ]]' \
  "STELLAR_NETWORK=mainnet but STELLAR_HORIZON_URL points to testnet. Transactions will fail."

# 4. Mainnet Stellar with testnet RPC URL
unsafe_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${STELLAR_RPC_URL:-}" == *"testnet"* ]]' \
  "STELLAR_NETWORK=mainnet but STELLAR_RPC_URL points to testnet. Contract calls will fail."

# 5. Testnet Stellar with testnet USDC issuer is fine, but mainnet with testnet USDC is dangerous
unsafe_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${USDC_ISSUER:-}" == "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" ]]' \
  "STELLAR_NETWORK=mainnet but USDC_ISSUER is the testnet Circle USDC issuer. USDC transfers will fail."

# 6. Live Paystack key in a non-production URL context
unsafe_combo \
  '[[ "${PAYSTACK_SECRET_KEY:-}" =~ ^sk_live_ && "${NEXT_PUBLIC_APP_URL:-}" =~ localhost ]]' \
  "PAYSTACK_SECRET_KEY is a live key but NEXT_PUBLIC_APP_URL is localhost. Do not process real payments locally."

# 7. Live Stripe key in a non-production URL context
unsafe_combo \
  '[[ "${STRIPE_SECRET_KEY:-}" =~ ^sk_live_ && "${NEXT_PUBLIC_APP_URL:-}" =~ localhost ]]' \
  "STRIPE_SECRET_KEY is a live key but NEXT_PUBLIC_APP_URL is localhost. Do not process real payments locally."

# 8. Production URL using http (not https) — MITM risk
unsafe_combo \
  '[[ "${NEXT_PUBLIC_APP_URL:-}" =~ ^http://lumigift\. ]]' \
  "NEXT_PUBLIC_APP_URL uses http:// for a production domain. Must use https://."

# ─── Warnings (non-fatal but worth flagging) ──────────────────────────────────

warn_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${STRIPE_SECRET_KEY:-}" =~ ^sk_test_ ]]' \
  "STELLAR_NETWORK=mainnet but STRIPE_SECRET_KEY is a test key. Stripe payments will fail in production."

warn_combo \
  '[[ "${STELLAR_NETWORK:-}" == "mainnet" && "${PAYSTACK_SECRET_KEY:-}" =~ ^sk_test_ ]]' \
  "STELLAR_NETWORK=mainnet but PAYSTACK_SECRET_KEY is a test key. Paystack payments will fail in production."

warn_combo \
  '[[ -n "${NEXTAUTH_SECRET_PREVIOUS:-}" && "${NEXTAUTH_SECRET:-}" == "${NEXTAUTH_SECRET_PREVIOUS:-}" ]]' \
  "NEXTAUTH_SECRET and NEXTAUTH_SECRET_PREVIOUS are identical. Key rotation has no effect."

# ─── Output results ───────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Environment Validation — Lumigift"
echo "  Environment: ${STELLAR_NETWORK:-unknown} / ${NEXT_PUBLIC_APP_URL:-unknown}"
echo "═══════════════════════════════════════════════════════"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "⚠️  Warnings (${#WARNINGS[@]}):"
  for w in "${WARNINGS[@]}"; do
    echo "   • $w"
  done
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo "❌ Errors (${#ERRORS[@]}) — startup blocked:"
  for e in "${ERRORS[@]}"; do
    echo "   • $e"
  done
  echo ""
  echo "Fix all errors above before starting the application."
  echo "═══════════════════════════════════════════════════════"
  exit 1
fi

echo ""
echo "✅ All environment checks passed."
echo "═══════════════════════════════════════════════════════"
