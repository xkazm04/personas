#!/bin/bash
# usage: ship-registry.sh   fast-forward the registry's origin main to the integration branch, from the INTEG worktree.
# The registry's own main checkout is never touched (another session may have it dirty); it catches up with a plain pull later.
. "$(dirname "$0")/env.sh"; cd "$INTEG" || exit 1
[ -n "$(git status --porcelain)" ] && { echo "integration worktree is dirty - stop"; exit 2; }
git fetch -q origin
read behind ahead < <(git rev-list --left-right --count origin/main...HEAD)
[ "$behind" != 0 ] && { echo "origin/main moved ($behind new commits): merge origin/main into $INTEG_BRANCH, rebuild derived files, retry"; exit 3; }
node scripts/build-index.mjs >/dev/null 2>&1; node scripts/build-catalog.mjs >/dev/null 2>&1
[ -n "$(git status --porcelain)" ] && { echo "derived files drifted - commit them first"; exit 4; }
node scripts/check-bundles.mjs 2>&1 | tail -1 | grep -q 'integrity OK' || { echo "check-bundles red"; exit 5; }
git push origin $INTEG_BRANCH:main && echo "shipped $ahead commits"
