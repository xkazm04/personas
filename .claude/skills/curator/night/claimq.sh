#!/bin/bash
# usage: claimq.sh <k>   claim the next QUEUE request and give it a registry worktree at $WT_ROOT/cn<k>
. "$(dirname "$0")/env.sh"; k=$1; cd "$PERSONAS"; L=.claude/skills/curator/loop.py
python $L next --terminal-owns --lane queue > "$NIGHT_DIR/claims/c$k.json" 2>&1
NIGHT_DIR="$NIGHT_DIR" K=$k python - <<'P'
import json,os,re
d=json.load(open(os.path.join(os.environ['NIGHT_DIR'],'claims','c%s.json'%os.environ['K'])));c=d.get('claim') or d
n=c.get('note') or ''
m=re.search(r'Subject address: (\S+?)\.?$',n.strip())
print('c'+os.environ['K'],c.get('lane'),c.get('skill'),c.get('argument'),'|',m.group(1) if m else n[:80],'|',c.get('declined'),d.get('held_by'))
P
cd "$REGISTRY"; git worktree add -q "$WT_ROOT/cn$k" -b cur/n$k "$INTEG_BRANCH" 2>/dev/null && cp .machine.local.json "$WT_ROOT/cn$k/"
