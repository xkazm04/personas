#!/bin/bash
# CI guard: fails if any TypeScript binding in src/lib/bindings/ is never
# referenced by application code OR by other binding files.
# Prevents dead bindings from accumulating as the Rust backend evolves
# faster than the frontend consumes new types.
#
# Since 2026-10-25 the check itself is scripts/check-unused-bindings.mjs: the
# same two questions (a whole-word reference anywhere in src/ outside a
# `bindings` directory, or an import from another binding), answered in one
# pass instead of one recursive grep per binding - 59 s on a CI runner became
# about a second. This file stays at its path because docs and the census
# cite it.

set -euo pipefail
exec node "$(dirname "$0")/check-unused-bindings.mjs" "$@"
