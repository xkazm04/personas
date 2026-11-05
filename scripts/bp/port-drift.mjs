#!/usr/bin/env node
// What bp has changed since Personas ported each file: reads the port ledger
// (src/features/decision-center/blueprint/bp-port.json) and, per entry, lists the bp commits after the entry's `sha`
// that touch its bp paths (`git -C <bp> log <sha>..HEAD -- <paths>`). A port with such commits is stale; one without is
// in sync. Report only: no network, no writes, exit 0 (exit 1 only when the ledger cannot be read).
//
//   node scripts/bp/port-drift.mjs [--bp <dir>] [--json]
//
// The bp checkout is `--bp <dir>`, else $BP_DIR, else the ledger's `bp_repo` relative to the repo root. A missing bp
// checkout prints one line and exits 0. A commit that only moved a path (a pure rename, R100: bp's monorepo moves) is
// listed but marked `(move)` and does not make a port stale.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = resolve(ROOT, 'src/features/decision-center/blueprint/bp-port.json');

const args = process.argv.slice(2);
const json = args.includes('--json');
const bpArg = args.indexOf('--bp') >= 0 ? args[args.indexOf('--bp') + 1] : undefined;

let ledger;
try {
  ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  if (!Array.isArray(ledger.files)) throw new Error('no files[]');
} catch (e) {
  console.error(`bp:drift: cannot read the port ledger ${LEDGER}: ${e.message}`);
  process.exit(1);
}

/** The main checkout's root when ROOT is a linked worktree (`.claude/worktrees/<slug>`), so `../bp` still means the
 *  sibling of the main checkout; ROOT itself otherwise. */
function mainRoot() {
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return dirname(common);
  } catch {
    return ROOT;
  }
}
const relBp = ledger.bp_repo ?? '../bp';
const bpDir = bpArg ? resolve(bpArg) : process.env.BP_DIR ? resolve(process.env.BP_DIR)
  : existsSync(resolve(ROOT, relBp)) ? resolve(ROOT, relBp) : resolve(mainRoot(), relBp);
const git = (...a) => execFileSync('git', ['-C', bpDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let head;
try {
  if (!existsSync(bpDir)) throw new Error('missing');
  head = git('rev-parse', '--short=7', 'HEAD');
} catch {
  console.log(`bp:drift: no bp checkout at ${bpDir} (pass --bp <dir> or set BP_DIR); nothing to compare.`);
  process.exit(0);
}

/** Whether commit `c` only renamed these paths with their content unchanged (R100): bp's monorepo moves, not drift. */
const STATUS = new Map();
function onlyMoves(c, paths) {
  let st = STATUS.get(c);
  if (!st) {
    st = new Map();
    for (const l of git('show', '-M', '--format=', '--name-status', c).split('\n')) {
      const p = l.split('\t');
      if (p.length) st.set(p[p.length - 1], p[0]);
    }
    STATUS.set(c, st);
  }
  const hits = paths.filter((p) => st.has(p));
  return hits.length > 0 && hits.every((p) => st.get(p) === 'R100');
}

const rows = ledger.files.map((f) => {
  try {
    git('cat-file', '-e', `${f.sha}^{commit}`);
  } catch {
    return { ...f, state: 'unknown', commits: [], why: `bp has no commit ${f.sha}` };
  }
  const out = git('log', '--format=%h %cs %s', `${f.sha}..HEAD`, '--', ...f.bp);
  const commits = out ? out.split('\n').map((l) => { const [h, d, ...s] = l.split(' '); return { sha: h, date: d, subject: s.join(' '), move: onlyMoves(h, f.bp) }; }) : [];
  return { ...f, state: commits.some((c) => !c.move) ? 'stale' : 'in-sync', commits };
});

const count = (s) => rows.filter((r) => r.state === s).length;
const totals = { ports: rows.length, stale: count('stale'), inSync: count('in-sync'), unknown: count('unknown'), bpHead: head, syncedTo: ledger.synced_to };

if (json) {
  console.log(JSON.stringify({ bp: bpDir, totals, files: rows }, null, 2));
  process.exit(0);
}

const order = { stale: 0, unknown: 1, 'in-sync': 2 };
rows.sort((a, b) => order[a.state] - order[b.state] || b.commits.filter((c) => !c.move).length - a.commits.filter((c) => !c.move).length || (a.file < b.file ? -1 : 1));
const w = Math.max(...rows.map((r) => r.file.length));
let group = '';
for (const r of rows) {
  if (r.state !== group) { group = r.state; console.log(`\n${group.toUpperCase()}`); }
  const k = r.commits.filter((c) => !c.move).length, m = r.commits.length - k;
  const n = r.state === 'unknown' ? r.why : [k ? `${k} commit${k === 1 ? '' : 's'}` : '', m ? `${m} move${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  console.log(`  ${r.file.padEnd(w)}  @ ${r.sha.padEnd(7)}  ${r.kind.padEnd(8)}  ${n}`);
  for (const c of r.commits) console.log(`      ${c.sha} ${c.date} ${c.move ? '(move) ' : ''}${c.subject}`);
}
console.log(`\n${totals.ports} ports: ${totals.stale} stale, ${totals.inSync} in sync, ${totals.unknown} unknown (bp HEAD ${head}, ledger synced to ${totals.syncedTo})`);
