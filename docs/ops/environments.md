# Environment Promotion & Configuration

> **Issue #106** — defines the four Lumigift environments, their variable requirements,
> the promotion path between them, and how configuration drift is detected automatically.

---

## Environments

| Environment  | Branch    | Stellar network | Payment keys | URL pattern                    |
| ------------ | --------- | --------------- | ------------ | ------------------------------ |
| `local`      | any       | testnet         | test         | `http://localhost:3000`        |
| `testnet`    | feature/* | testnet         | test         | Vercel preview URL             |
| `staging`    | develop   | testnet         | test         | `https://staging.lumigift.app` |
| `production` | main      | mainnet         | live         | `https://lumigift.app`         |

---

## Variable Matrix

The table below shows which value each environment uses.
`[secret]` means the value is injected at deploy time from the relevant secret store
(GitHub Environment secret / AWS Secrets Manager) and is never committed.

| Variable                     | local                                 | testnet (preview)             | staging                        | production                                       |
| ---------------------------- | ------------------------------------- | ----------------------------- | ------------------------------ | ------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`        | `http://localhost:3000`               | Vercel preview URL            | `https://staging.lumigift.app` | `https://lumigift.app`                           |
| `NEXTAUTH_URL`               | `http://localhost:3000`               | Vercel preview URL            | `https://staging.lumigift.app` | `https://lumigift.app`                           |
| `NEXTAUTH_SECRET`            | [secret — local .env]                 | [secret — Vercel preview env] | [secret — staging env]         | [secret — production env]                        |
| `STELLAR_NETWORK`            | `testnet`                             | `testnet`                     | `testnet`                      | `mainnet`                                        |
| `STELLAR_HORIZON_URL`        | `https://horizon-testnet.stellar.org` | same                          | same                           | `https://horizon.stellar.org`                    |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015`   | same                          | same                           | `Public Global Stellar Network ; September 2015` |
| `STELLAR_RPC_URL`            | `https://soroban-testnet.stellar.org` | same                          | same                           | `https://soroban-rpc.stellar.org`                |
| `USDC_ISSUER`                | testnet Circle issuer                 | same                          | same                           | mainnet Circle issuer                            |
| `PAYSTACK_SECRET_KEY`        | `sk_test_…`                           | `sk_test_…`                   | `sk_test_…`                    | `sk_live_…`                                      |
| `STRIPE_SECRET_KEY`          | `sk_test_…`                           | `sk_test_…`                   | `sk_test_…`                    | `sk_live_…`                                      |
| `DATABASE_URL`               | `postgresql://…localhost…`            | [secret — Vercel preview env] | [secret — staging RDS]         | [secret — production RDS]                        |
| `REDIS_URL`                  | `redis://localhost:6379`              | [secret — preview Redis]      | [secret — staging ElastiCache] | [secret — prod ElastiCache]                      |

---

## Unsafe Combinations (startup blocked)

The following combinations are detected by `scripts/env-validate.sh` and will **block
application startup** with a clear error message.

| Condition                                             | Why it is unsafe                                    |
| ----------------------------------------------------- | --------------------------------------------------- |
| Production domain + `STELLAR_NETWORK=testnet`         | Real user funds would lock on the testnet           |
| `STELLAR_NETWORK=mainnet` + testnet passphrase        | All transactions will be rejected by the network    |
| `STELLAR_NETWORK=mainnet` + testnet Horizon / RPC URL | Contract calls and queries will fail silently       |
| `STELLAR_NETWORK=mainnet` + testnet `USDC_ISSUER`     | USDC transfers will fail; wrong asset on mainnet    |
| Live Paystack/Stripe key + `localhost` app URL        | Real money would be charged in a local dev session  |
| Production domain over `http://`                      | Credentials transmitted in plaintext; MITM risk     |
| Placeholder secrets still present                     | App starts but authentication / payments are broken |
| `NEXTAUTH_SECRET` length < 32 chars                   | JWTs are trivially brute-forceable                  |

### Running the validator manually

```bash
# Against your active environment
bash scripts/env-validate.sh

# Against a specific env file
bash scripts/env-validate.sh .env.local
```

Exit code 0 = all checks passed. Exit code 1 = one or more errors found.

---

## Promotion Path

```
local dev  →  testnet preview  →  staging  →  production
               (feature branch)   (develop)    (main)
```

### local → testnet preview

1. Push your feature branch — Vercel creates a preview deployment automatically.
2. The `env-drift.yml` CI workflow checks that all required variables are documented.
3. Verify the Vercel preview has the correct Vercel environment variables set
   (Settings → Environment Variables → Preview).

### testnet preview → staging

1. Open a PR from your feature branch to `develop`.
2. CI must pass: lint, type-check, unit tests, drift detection.
3. Merge to `develop` — `staging.yml` deploys to the staging Vercel environment.
4. Smoke tests run automatically against `https://staging.lumigift.app`.

### staging → production

1. Open a PR from `develop` to `main`.
2. All CI checks must pass.
3. Confirm load-test results meet capacity targets (see `docs/performance/load-test-results.md`).
4. Merge to `main` — `deploy.yml` deploys to the production Vercel environment.

> **Never** push directly to `main` without a reviewed PR.

---

## Drift Detection

Configuration drift is detected automatically by `.github/workflows/env-drift.yml`.

The workflow runs:

- On every push/PR that touches `.env.example`, `env.ts`, or `env-validate.sh`
- Weekly (Monday 08:00 UTC) to catch out-of-band changes

**What it checks:**

1. Every key in the Zod schema (`src/server/config/env.ts`) is documented in `.env.example`.
2. `scripts/env-validate.sh` is executable and has no syntax errors.
3. Unsafe variable combinations are flagged on a test run.

**When drift is detected:**

- The CI job fails with a clear list of missing/extra keys.
- Update `.env.example` and re-run to resolve.

---

## Adding a New Environment Variable

1. Add the variable to the Zod schema in `src/server/config/env.ts`.
2. Add it to `.env.example` with a safe placeholder value and a comment.
3. Add it to `.env.local.example` if it is needed for local Docker development.
4. Set the actual value in:
   - **Local:** `.env.local` (gitignored)
   - **Staging:** GitHub Environment secret (`staging`) or Vercel staging env
   - **Production:** AWS Secrets Manager + Vercel production env
5. If it introduces a new unsafe combination, add a guard to `scripts/env-validate.sh`.
6. Push — the drift detection CI job will verify everything is aligned.

---

## Secret Rotation

Follow `docs/ops/key-rotation.md` for rotating production secrets.
The general procedure is:

1. Generate the new secret.
2. Set the old value in `*_PREVIOUS` (e.g. `NEXTAUTH_SECRET_PREVIOUS`).
3. Deploy the new value.
4. Wait for the grace period (`NEXTAUTH_ROTATION_GRACE_HOURS`, default 24 h).
5. Remove the `_PREVIOUS` variable.

---

## References

- `scripts/env-validate.sh` — startup validation script
- `.github/workflows/env-drift.yml` — automated drift detection CI
- `src/server/config/env.ts` — Zod schema (source of truth for required variables)
- `.env.example` — documented variable list with safe placeholder values
- `.env.local.example` — local Docker development defaults
- `docs/ops/staging.md` — staging-specific secrets and smoke tests
- `docs/ops/key-rotation.md` — secret rotation procedures
