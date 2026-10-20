# Contributor Testing & Quality Guide

> Closes #112

This guide documents every test command available in Lumigift, how they map to
CI checks, and what you need to run them locally.

---

## Prerequisites

| Requirement                            | Version | Purpose                          |
| -------------------------------------- | ------- | -------------------------------- |
| Node.js                                | ≥ 20    | All JS/TS commands               |
| npm                                    | ≥ 10    | Package management               |
| PostgreSQL                             | ≥ 14    | Integration tests                |
| Redis                                  | ≥ 7     | Integration tests                |
| Rust + `wasm32-unknown-unknown` target | stable  | Contract tests                   |
| Stellar CLI                            | latest  | Contract deployment verification |

Install JS dependencies:

```bash
npm ci
```

Install Playwright browsers (E2E and visual tests only):

```bash
npx playwright install --with-deps chromium
```

---

## Environment Variables

Most test suites do **not** touch external services. The exceptions are:

| Suite                    | Required env vars                              | Notes                                |
| ------------------------ | ---------------------------------------------- | ------------------------------------ |
| Integration tests        | `TEST_DATABASE_URL`                            | Points to a local test PostgreSQL DB |
| E2E / visual tests       | Full `.env.local` set                          | App must build and start             |
| Contract deploy (manual) | `STELLAR_SERVER_SECRET_KEY`, `STELLAR_NETWORK` | Testnet only for local runs          |

Copy the example file and fill in values:

```bash
cp .env.local.example .env.local
```

For integration tests only, the minimum required variable is:

```bash
export TEST_DATABASE_URL=postgresql://lumigift:lumigift@localhost:5432/lumigift_test
```

**Important:** Never commit real secrets. The `.env.local` file is gitignored.

---

## Test Commands

All commands below correspond directly to `package.json` scripts and are
mirrored exactly in CI (`.github/workflows/ci.yml`).

### 1. Unit Tests (Jest)

```bash
npm test
```

Runs Jest with `--passWithNoTests`. All files matching `**/__tests__/**/*.test.ts(x)` and `**/*.test.ts(x)`.

Run with coverage:

```bash
npm run test:coverage
```

Coverage is reported to Codecov in CI. The CI threshold is **70 %** — PRs that
drop below this threshold will fail.

Watch mode (re-runs on file change):

```bash
npm run test:watch
```

### 2. Integration Tests

Integration tests live alongside unit tests but require a live PostgreSQL
instance. The CI job spins up `postgres:16` as a service container.

Seed the test database first:

```bash
npm run db:seed:test
```

Then run only integration tests:

```bash
npm test -- --testPathPattern="integration"
```

### 3. E2E Tests (Playwright)

End-to-end tests cover the full gift creation and claim flows in a real browser.

```bash
# Build the Next.js app first
npm run build

# Run E2E suite (Playwright starts the server automatically)
npm run e2e
```

The `playwright.config.ts` `webServer` block starts `npm run start` and waits
for it to be ready before tests run. Ensure your `.env.local` contains valid
values (real payment provider keys are **not** required — mock callbacks are
used).

On failure, Playwright saves screenshots and videos to `test-results/` and an
HTML report to `playwright-report/`. Both directories are gitignored.

### 4. Visual Regression (Playwright snapshots)

Visual regression tests compare component screenshots against committed
baselines.

```bash
npm run test:visual
```

To update baseline snapshots after intentional UI changes:

```bash
npm run test:visual:update
```

Baseline snapshots live in `e2e/visual/__snapshots__/`. Snapshot diffs are
uploaded as CI artifacts on failure (retained 7 days). The `__snapshots__/`
directories are gitignored — only committed baselines are tracked.

### 5. Soroban Contract Tests (Rust / cargo)

```bash
npm run contract:test
# Equivalent to: cd contracts && cargo test
```

This runs the full Rust test suite for the escrow contract, including unit tests
and property-based (proptest) fuzz tests matching the `fuzz_` prefix.

Build the WASM artifact:

```bash
npm run contract:build
# Equivalent to: cd contracts && stellar contract build
```

Run resource-budget benchmarks:

```bash
cd contracts && cargo bench --bench escrow_bench -- --noplot
```

### 6. Coverage

JavaScript coverage:

```bash
npm run test:coverage
```

Output goes to `coverage/` (gitignored). Open `coverage/lcov-report/index.html`
locally.

### 7. Mutation Testing (Stryker)

Mutation testing verifies that your tests can catch real bugs by introducing
small code mutations.

```bash
npm run mutation
# Equivalent to: stryker run
```

Uses `stryker.config.js`. This is a slow command — run it before large PRs or
when adding critical business logic.

### 8. Lint, Type-Check, and Format

```bash
# ESLint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# TypeScript type check (no emit)
npm run type-check

# Prettier format check
npm run format:check

# Auto-format all files
npm run format
```

These four checks all run together in the CI `lint-and-type-check` job. PRs
**must** pass all four.

### 9. Security Audits

```bash
# Node.js dependency audit
npm audit --audit-level=high

# Rust dependency audit
cd contracts && cargo audit

# License compliance check
npm run license:check
```

The license check blocks `GPL`, `AGPL`, and `LGPL` licenses from production
dependencies. See `package.json` `license:check` script for the full deny list.

---

## CI Job Map

| CI job                | Local command(s)                                                          | Trigger         |
| --------------------- | ------------------------------------------------------------------------- | --------------- |
| `secret-scan`         | (gitleaks — CI only)                                                      | push / PR       |
| `lint-and-type-check` | `npm run lint`, `npm run type-check`, `npm run format:check`, `npm audit` | push / PR       |
| `test` (Unit Tests)   | `npm test -- --coverage`                                                  | push / PR       |
| `build`               | `npm run build`                                                           | push / PR       |
| `e2e`                 | `npm run e2e`                                                             | push / PR       |
| `integration-tests`   | `npm run db:seed:test && npm test -- --testPathPattern="integration"`     | push / PR       |
| `visual-snapshots`    | `npm run test:visual`                                                     | push / PR       |
| `license-check`       | `npm run license:check`, `cargo license`                                  | push / PR       |
| `contract-test`       | `npm run contract:test`, `cargo audit`                                    | push / PR       |
| `contract-fuzz`       | `cargo test fuzz_`                                                        | push / PR       |
| `contract-build`      | `npm run contract:build`                                                  | push / PR       |
| `contract-budget`     | `cargo bench --bench escrow_bench`                                        | push / PR       |
| `mutation-testing`    | `npm run mutation`                                                        | weekly schedule |

---

## Pre-commit Hooks

Husky runs lint-staged on every commit:

- `*.{ts,tsx}` → `prettier --write`
- `*.{json,md,css}` → `prettier --write`

These run automatically. If a commit is rejected, run `npm run format` and
re-stage.

---

## Quick Reference

```bash
# Full local quality gate (mirrors CI exactly)
npm run lint && npm run type-check && npm run format:check && npm test -- --coverage

# Contract quality gate
npm run contract:test && npm run contract:build

# Everything (slow — for pre-PR validation)
npm run lint && npm run type-check && npm run format:check \
  && npm test -- --coverage \
  && npm run contract:test \
  && npm run e2e
```
