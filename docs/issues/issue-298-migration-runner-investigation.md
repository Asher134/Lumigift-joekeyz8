# Issue #298: Automated database migration deployment

This is an investigation PR, not a migration runner or deployment change. Running the existing SQL automatically before deploy needs a migration-history and recovery policy first.

## Findings

- Migration files have duplicate numeric prefixes (`0002` and `0008`), so a runner cannot safely use the prefix alone as its applied-migration identity.
- There is no migration ledger or runner in the repository today. The deploy workflows build and deploy but do not apply database changes.
- Existing migrations are not uniformly replay-safe. For example, `0002_normalize_phone_e164.sql` adds a named check constraint without an existence guard, and `0003_hash_recipient_phone.sql` performs a data backfill and drops the plaintext `recipient_phone` column.
- A rollback for the phone-hashing migration cannot restore the dropped plaintext values. Automatically rolling back after a later migration fails would therefore risk irreversible data loss.

## Decisions needed

1. Use the full migration filename (or a separate immutable ID) as the ledger key, and establish ordering for existing migrations with duplicate prefixes.
2. Choose a deployment model for staging and production: required database credentials, least-privilege role, advisory lock, transaction boundaries, and behavior when a migration fails.
3. Decide on forward-only corrective migrations versus rollback scripts. Destructive data changes must not claim a reversible rollback unless the original data is retained.
4. Define how to baseline databases that already have some or all migrations applied before enabling automation.

After these decisions, the runner and deployment workflow should be introduced with a disposable PostgreSQL integration test covering first run, rerun, partial failure, concurrent invocation, and pre-existing schema baselining. Deployment must remain blocked when migration application fails.
