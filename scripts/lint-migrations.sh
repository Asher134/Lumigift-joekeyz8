#!/usr/bin/env bash
# lint-migrations.sh
#
# Scans SQL migration files for dangerous operations that must not appear
# outside a dedicated Phase 3 (_phase3.sql) migration file.
#
# Usage:
#   bash scripts/lint-migrations.sh              # check all migrations/
#   bash scripts/lint-migrations.sh path/to.sql  # check a specific file
#
# Exit codes:
#   0  — no dangerous operations found (or all are in _phase3 files)
#   1  — dangerous operations found in a non-phase-3 file
#
# CI integration: add this script as a step in .github/workflows/ci.yml
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

MIGRATIONS_DIR="${1:-migrations}"
FOUND_ISSUES=0

# Patterns considered dangerous outside a phase-3 migration.
# Each entry is an extended-regex pattern (grep -E).
DANGEROUS_PATTERNS=(
  "[Dd][Rr][Oo][Pp][[:space:]]+[Cc][Oo][Ll][Uu][Mm][Nn]"
  "[Dd][Rr][Oo][Pp][[:space:]]+[Tt][Aa][Bb][Ll][Ee]"
  "[Aa][Ll][Tt][Ee][Rr][[:space:]]+[Tt][Aa][Bb][Ll][Ee].*[Dd][Rr][Oo][Pp][[:space:]]"
  "[Rr][Ee][Nn][Aa][Mm][Ee][[:space:]]+[Cc][Oo][Ll][Uu][Mm][Nn]"
  "[Rr][Ee][Nn][Aa][Mm][Ee][[:space:]]+[Tt][Oo]"
)

# Build a combined grep pattern
COMBINED=""
for pat in "${DANGEROUS_PATTERNS[@]}"; do
  if [ -z "$COMBINED" ]; then
    COMBINED="$pat"
  else
    COMBINED="$COMBINED|$pat"
  fi
done

# Find all SQL files to check (exclude _phase3.sql — those are intentional)
if [ -d "$MIGRATIONS_DIR" ]; then
  MIGRATION_FILES=$(find "$MIGRATIONS_DIR" -name "*.sql" ! -name "*_phase3.sql" | sort)
else
  # Single file passed as argument
  MIGRATION_FILES="$MIGRATIONS_DIR"
fi

if [ -z "$MIGRATION_FILES" ]; then
  echo "✅ No migration files to lint."
  exit 0
fi

echo "🔍 Linting migration files for dangerous operations..."
echo ""

for file in $MIGRATION_FILES; do
  # Skip phase3 files even if they somehow appear in the list
  if [[ "$file" == *_phase3.sql ]]; then
    continue
  fi

  # Strip SQL comments before grepping to avoid matching commented-out examples
  # (single-line -- comments and block /* */ comments)
  stripped=$(sed 's/--.*//g' "$file" | tr '\n' ' ' | sed 's|/\*[^*]*\*\+([^/*][^*]*\*\+)*/||g')

  if echo "$stripped" | grep -Eiq "($COMBINED)"; then
    echo "❌  $file"
    echo "   Contains a dangerous operation (DROP COLUMN, DROP TABLE, RENAME COLUMN/TABLE)."
    echo "   These operations must be in a separate Phase 3 migration file named"
    echo "   '*_phase3.sql' and deployed independently of the code change."
    echo "   See docs/ops/blue-green-migrations.md for the expand→migrate→contract strategy."
    echo ""
    FOUND_ISSUES=1
  fi
done

if [ "$FOUND_ISSUES" -eq 0 ]; then
  echo "✅ All migration files look safe (no dangerous operations outside phase-3 files)."
  exit 0
else
  exit 1
fi
