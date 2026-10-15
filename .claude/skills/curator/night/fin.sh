#!/bin/bash
# usage: fin.sh <n> "<merge desc>" <state> "<evidence>" [<next k>]
# Queue-lane settle states are landed|declined|failed|cancelled. `idled` is a PLAN-lane word: sent to the queue lane
# it fails SILENTLY and leaves the claim open, so it is mapped to `declined` here.
. "$(dirname "$0")/env.sh"; n=$1; desc=$2; st=$3; ev=$4; k=$5
"$(dirname "$0")/integrate.sh" $n "$desc" 2>&1 | grep -v "^Updated\|^CONFLICTS\|^knowledge/\|^rules/\|^catalog"
cd "$PERSONAS"; [ "$st" = idled ] && st=declined
python .claude/skills/curator/loop.py settle --claim "$NIGHT_DIR/claims/c$n.json" --state $st --evidence "$ev" | grep -E "settled|error"
# The claim's project clones ($WT_ROOT/cn<n>-<proj>, and a cn<n>-target) are where the night's bytes go: the
# 2026-10-14 night left ~200 GB in 13 h because integrate.sh removes only the registry worktree. The registry's
# disk lane deletes a clone only when every commit is on its remotes and nothing but install noise is dirty;
# anything it keeps is printed with the reason and stays for the operator.
shopt -s nullglob; clones=("$WT_ROOT"/cn$n-*); shopt -u nullglob
if [ ${#clones[@]} -gt 0 ]; then
  node "$REGISTRY/scripts/hygiene-disk.mjs" --scratch "$WT_ROOT" --reap "${clones[@]}" > "$NIGHT_DIR/reap$n.out" 2>&1
  echo "reaped $(grep -c '"done":true' "$NIGHT_DIR/reap$n.out") of ${#clones[@]} clone dirs"; grep '"done":false' "$NIGHT_DIR/reap$n.out"
fi
[ -n "$k" ] && "$(dirname "$0")/claimq.sh" $k
date +%H:%M
