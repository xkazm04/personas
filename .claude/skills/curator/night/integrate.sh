#!/bin/bash
# usage: integrate.sh <n> <subject-note>   merge cur/n<n> into the integration branch, never the registry's main checkout
. "$(dirname "$0")/env.sh"; n=$1; cd "$INTEG" || exit 1
msg="merge(cur/n$n): $2

$COAUTHOR"
if ! git merge --no-ff -m "$msg" cur/n$n >"$NIGHT_DIR/merge$n.out" 2>&1; then
  conf=$(git diff --name-only --diff-filter=U); if [ -z "$conf" ]; then echo "MERGE FAILED: $(head -3 "$NIGHT_DIR/merge$n.out")"; exit 4; fi
  echo "CONFLICTS: $conf"
  # Derived files are regenerated, never hand-merged. Anything else is a real conflict a human reads.
  for f in $conf; do case $f in catalog.json|*/index.json|*/index.md|rules/*|.claude-plugin/marketplace.json) git checkout --ours $f;; *) echo "REAL CONFLICT $f"; exit 2;; esac; done
  node scripts/build-index.mjs >/dev/null; node scripts/build-catalog.mjs >/dev/null; node scripts/build-knowledge-rules.mjs >/dev/null
  git add catalog.json $(git diff --name-only | grep -E 'index\.(json|md)$|^rules/|marketplace') 2>/dev/null
  git commit -q --no-edit -m "$msg" || exit 3
fi
node scripts/check-bundles.mjs 2>&1 | tail -1
git log --oneline -1
# The worker's registry worktree has no node_modules junction, so --force is safe HERE. It is NOT safe on a project clone.
git worktree remove --force "$WT_ROOT/cn$n" 2>&1 | tail -1; git branch -d cur/n$n | tail -1
