#!/bin/bash
# usage: fin.sh <n> "<merge desc>" <state> "<evidence>" [<next k>]
# Queue-lane settle states are landed|declined|failed|cancelled. `idled` is a PLAN-lane word: sent to the queue lane
# it fails SILENTLY and leaves the claim open, so it is mapped to `declined` here.
. "$(dirname "$0")/env.sh"; n=$1; desc=$2; st=$3; ev=$4; k=$5
"$(dirname "$0")/integrate.sh" $n "$desc" 2>&1 | grep -v "^Updated\|^CONFLICTS\|^knowledge/\|^rules/\|^catalog"
cd "$PERSONAS"; [ "$st" = idled ] && st=declined
python .claude/skills/curator/loop.py settle --claim "$NIGHT_DIR/claims/c$n.json" --state $st --evidence "$ev" | grep -E "settled|error"
[ -n "$k" ] && "$(dirname "$0")/claimq.sh" $k
date +%H:%M
