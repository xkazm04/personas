#!/bin/bash
# usage: claimnext.sh <k>   claim from queue,plan; skip (and settle idled) techniques already in librarian/applied.md
. "$(dirname "$0")/env.sh"; k=$1; cd "$PERSONAS"; L=.claude/skills/curator/loop.py; D="$NIGHT_DIR/claims"
for try in 1 2 3 4 5 6; do
  python $L next --terminal-owns --lane queue,plan --engine ${ENGINES:-apply,deepen,reconcile} > $D/c$k.json 2>&1
  out=$(python -c "import json;d=json.load(open(r'$D/c$k.json'));c=d.get('claim') or d;print(c.get('skill'),'|',c.get('argument'),'|',c.get('subject'),'|',c.get('declined'),'|',d.get('held_by'))")
  arg=$(echo "$out" | cut -d'|' -f2 | awk '{print $NF}')
  if [ "$(echo $out | cut -d' ' -f1)" = "intake" ] && grep -q -- "$arg" "$INTEG/librarian/applied.md"; then
    python $L settle --claim $D/c$k.json --state idled --evidence "technique $arg already in librarian/applied.md; not dispatched" >/dev/null
    echo "skipped dup: $arg"; continue
  fi
  echo "c$k: $out"; exit 0
done
