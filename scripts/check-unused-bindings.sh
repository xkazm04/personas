#!/bin/bash
# CI guard: fails if any TypeScript binding in src/lib/bindings/ is never
# referenced by application code OR by other binding files.
# Prevents dead bindings from accumulating as the Rust backend evolves
# faster than the frontend consumes new types.

set -euo pipefail

BINDINGS_DIR="src/lib/bindings"
UNUSED=()

for f in "$BINDINGS_DIR"/*.ts; do
  name=$(basename "$f" .ts)
  [ "$name" = "index" ] && continue

  # Check 1: referenced by app code outside bindings/
  if grep -rw "$name" src/ --include='*.ts' --include='*.tsx' --exclude-dir=bindings -q 2>/dev/null; then
    continue
  fi

  # Check 2: imported by another binding file (structural dependency)
  if grep -l "from \"./$name\"" "$BINDINGS_DIR"/*.ts 2>/dev/null | grep -v "/${name}.ts$" | grep -v "/index.ts$" -q 2>/dev/null; then
    continue
  fi

  UNUSED+=("$name")
done

if [ ${#UNUSED[@]} -gt 0 ]; then
  echo "ERROR: ${#UNUSED[@]} unused binding(s) found in $BINDINGS_DIR:"
  printf '  %s\n' "${UNUSED[@]}"
  echo ""
  echo "Remove unused .ts files and their index.ts exports, or start using them."
  exit 1
fi

echo "OK: all bindings in $BINDINGS_DIR are referenced by application code or other bindings."
