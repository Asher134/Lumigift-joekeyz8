# Blue-Green Database Migration Strategy

## The Problem

During a rolling deploy the old version and the new version of the application run
simultaneously against the same database schema. A migration that **removes** a
column, **renames** a column, or **changes a type** will break the old version while
the new version is still being rolled out, causing errors and potential data loss.

## Strategy: Expand → Migrate Data → Contract

All schema changes must follow the **three-phase** approach:

```
Phase 1 — EXPAND   : add new column / table (backward-compatible)
Phase 2 — MIGRATE  : back-fill data, update application code
Phase 3 — CONTRACT : remove old column / table (separate deploy)
```

Each phase is its own PR and its own deploy. Phases 1 and 3 are never
combined in the same deploy as the code that reads/writes the new schema.

### Phase 1 — Expand (backward-compatible additions)

- `ADD COLUMN` with a `DEFAULT` or nullable
- `CREATE TABLE`
- `CREATE INDEX CONCURRENTLY`
- Add a new enum value (using `ALTER TYPE ... ADD VALUE`)

All safe to deploy while the old app version is still running.

### Phase 2 — Migrate Data

- Back-fill new column: `UPDATE table SET new_col = <expr> WHERE new_col IS NULL`
- Flip application code to write to the new column (but still read old)
- Dual-write period if needed

### Phase 3 — Contract (destructive cleanup — separate deploy)

- `DROP COLUMN`
- `DROP TABLE`
- `ALTER COLUMN ... SET NOT NULL` (only after back-fill is 100% complete)
- Remove old dual-write code

> **Rule**: Never put a `DROP COLUMN` or `DROP TABLE` in the same deploy as the
> code change that stops reading that column / table.

## Dangerous Operations That Require Extra Care

| Operation                           | Risk                                    | Mitigation                                     |
| ----------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `DROP COLUMN`                       | Breaks old app version immediately      | Phase 3 only, separate deploy                  |
| `DROP TABLE`                        | Same as above                           | Phase 3 only, separate deploy                  |
| `ALTER COLUMN … TYPE`               | Rewrites the entire table, takes lock   | Add new column, back-fill, then drop old       |
| `ALTER COLUMN … SET NOT NULL`       | Fails if any NULLs exist                | Back-fill first, then constrain                |
| `DROP INDEX` / `DROP CONSTRAINT`    | Can break existing queries/FKs          | Verify no active queries depend on it          |
| `RENAME COLUMN` / `RENAME TABLE`    | Breaks all existing queries immediately | Add new name, dual-write, then remove old name |
| `CREATE INDEX` (without CONCURRENT) | Takes lock, blocks writes               | Always use `CREATE INDEX CONCURRENTLY`         |

## Runbook: Blue-Green Migration Procedure

### Pre-deploy checklist

- [ ] Migration file reviewed by at least one other engineer
- [ ] CI migration-lint job passes (no dangerous operations in the wrong phase)
- [ ] Back-fill query estimated for execution time on production row count
- [ ] If back-fill > 30 s estimated, plan for batched back-fill
- [ ] Rollback plan documented (what SQL reverses this migration?)

### Deploy sequence

```
1. Merge & deploy Phase 1 (EXPAND) migration
   └── Verify new column / table exists in production
   └── Verify old app version is still error-free

2. Merge & deploy application code change
   └── Application now writes to new schema
   └── Monitor error rates for 30 min

3. Merge & deploy Phase 3 (CONTRACT) migration
   └── Verify DROP succeeded
   └── Run reconciliation query to confirm no references remain
```

### Rollback

Each migration should have a matching rollback comment or a `down` script:

```sql
-- rollback: ALTER TABLE gifts DROP COLUMN IF EXISTS new_col;
```

For Phase 3 (drops), rollback is not possible without restoring from backup.
Ensure Phase 3 is only executed after Phase 2 has been stable for ≥24 hours.

## Migration Lint CI Check

A CI job (`migration-lint`) scans every `.sql` file changed in the PR for
dangerous operations in the wrong context. It runs in `.github/workflows/ci.yml`.

The script lives at `scripts/lint-migrations.sh`. To run locally:

```bash
bash scripts/lint-migrations.sh
```

The script exits non-zero if it finds any of the following in a migration file
that is **not** suffixed with `_phase3.sql`:

- `DROP COLUMN`
- `DROP TABLE`
- `ALTER TABLE … DROP`
- `RENAME COLUMN` / `RENAME TABLE`

Phase 3 migrations **must** be named `<number>_<description>_phase3.sql` so the
lint script knows they are intentional.

## Example: Refactoring `0002_normalize_phone_e164.sql`

The original migration (`0002_normalize_phone_e164.sql`) adds a `phone_normalized`
column and back-fills it in a single migration. This is safe as a Phase 1+2
combined step because it only **adds** a column — it does not drop anything.

If a future migration needs to drop `phone` in favour of `phone_normalized`, that
must be a separate Phase 3 migration named, for example:
`0008_drop_legacy_phone_phase3.sql`.

## References

- [PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)
- [CREATE INDEX CONCURRENTLY](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [Strong Migrations (Rails, but principles apply)](https://github.com/ankane/strong_migrations)
