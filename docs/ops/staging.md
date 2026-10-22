# Staging Environment

Lumigift uses a staging environment to validate changes before they reach production users.

## How it works

- Pushes to the `develop` branch automatically trigger `.github/workflows/staging.yml`
- The workflow builds the app with **testnet** Stellar configuration and deploys a Vercel preview
- Smoke tests run against the live staging URL after deployment

## Stellar network

Staging always uses **Stellar testnet**:

| Variable                     | Value                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `STELLAR_NETWORK`            | `testnet`                                                  |
| `STELLAR_HORIZON_URL`        | `https://horizon-testnet.stellar.org`                      |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015`                        |
| `USDC_ISSUER`                | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

## GitHub Secrets (staging)

All staging secrets use the `STAGING_` prefix and are stored in the **staging** GitHub
environment (`Settings → Environments → staging`).

| Secret                               | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `STAGING_NEXTAUTH_SECRET`            | NextAuth JWT signing secret                 |
| `STAGING_DATABASE_URL`               | PostgreSQL connection string for staging DB |
| `STAGING_STELLAR_ESCROW_CONTRACT_ID` | Testnet escrow contract address             |
| `STAGING_STELLAR_SERVER_SECRET_KEY`  | Testnet Stellar signing key                 |
| `STAGING_PAYSTACK_SECRET_KEY`        | Paystack test-mode secret key               |
| `STAGING_STRIPE_SECRET_KEY`          | Stripe test-mode secret key                 |
| `STAGING_STRIPE_WEBHOOK_SECRET`      | Stripe webhook signing secret (test)        |
| `STAGING_TERMII_API_KEY`             | Termii API key (test environment)           |
| `STAGING_REDIS_URL`                  | Redis connection string for staging         |
| `STAGING_CRON_SECRET`                | Bearer token for `/api/cron/unlock`         |

GitHub variables (non-secret, stored in the staging environment):

| Variable          | Example                        |
| ----------------- | ------------------------------ |
| `STAGING_APP_URL` | `https://staging.lumigift.app` |

Shared secrets (used by both staging and production):

| Secret              | Description            |
| ------------------- | ---------------------- |
| `VERCEL_TOKEN`      | Vercel API token       |
| `VERCEL_ORG_ID`     | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID      |

## Smoke tests

After each staging deployment, Playwright runs tests tagged `@smoke` against the live URL.
To tag a test as a smoke test, add `@smoke` to its title:

```typescript
test("@smoke homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Lumigift/);
});
```

## Promoting to production

Once staging is validated, merge `develop` → `main`. The production deploy workflow
(`.github/workflows/deploy.yml`) will trigger automatically.

---

## Staging ↔ Production Parity Checks (Issue #294)

An automated parity check runs on every push to `develop` and on a weekly
schedule (Mondays 08:00 UTC). It is defined in
`.github/workflows/staging-parity.yml`.

### What is checked

| Check              | What it does                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Env-var key parity | Verifies every required secret/variable key from `.env.example` is present in the `staging` GitHub environment |
| PR comment         | Posts a parity report as a comment on deploy-triggering PRs                                                    |
| Weekly schedule    | Catches drift even without a deploy                                                                            |

The check compares **keys only** — secret values are never read or logged.

### What it does NOT check automatically

- **DB schema drift** between staging and production: detected by running
  migrations on both environments and comparing the output. This is a manual
  step until a migration-diffing tool is integrated.
- **Feature flag parity**: document any divergences in this file when they are
  intentional.

### When the parity check fails

1. Go to **Settings → Environments → staging** in the GitHub repository.
2. Add the missing secret or variable listed in the parity report.
3. Re-run the failed workflow from the Actions tab.

If a discrepancy is intentional (e.g. a staging-only override), document it in
the table below.

### Known intentional staging/production differences

| Variable               | Staging value        | Production value | Reason                                   |
| ---------------------- | -------------------- | ---------------- | ---------------------------------------- |
| `STELLAR_NETWORK`      | `testnet`            | `mainnet`        | Staging uses testnet to avoid real money |
| `NEXT_PUBLIC_APP_NAME` | `Lumigift (Staging)` | `Lumigift`       | Visual indicator in UI                   |
| Stellar Horizon URL    | testnet endpoint     | mainnet endpoint | Follows network                          |
