// Every path in feature-doc-map.json must actually match something.
//
// The doc-sync Stop hook matches a turn's edits against `sourceGlobs` and nags
// when a coupled doc was not updated. A glob that matches NO file cannot nag —
// it fails open, silently, forever, and looks exactly like a feature nobody
// edited. Found 2026-08-14: `src-tauri/src/commands/infrastructure/live_roadmap.rs`
// is really at `src-tauri/src/commands/live_roadmap.rs`, so the hook has never
// once fired for live-roadmap.
//
// This is the same defect family as the dead doc links and the binding-drift
// check that cannot see new files: a gate whose precondition quietly vanished.
// A referenced path that does not exist is structurally invisible to any
// content-matching check, so it needs its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location — see the note in
// scripts/census/check-corpus-integrity.mjs. This was hardcoded to the author's
// machine, and as step 6 of `npm run check`'s `&&` chain it aborted the run
// everywhere else.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MAP = path.join(ROOT, 'scripts/docs/feature-doc-map.json');

if (!fs.existsSync(MAP)) {
  console.error(`FATAL: ${MAP} missing — cannot check. Failing loudly.`);
  process.exit(2);
}
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));

// Walk once; glob-matching against a file list beats shelling out per pattern.
const all = [];
const walk = (d) => {
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (['node_modules', 'target', '.git', 'dist', '.claude'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else all.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
};
walk(ROOT);

if (all.length < 1000) {
  console.error(`FATAL: walked only ${all.length} files; expected thousands. THE WALKER IS BROKEN.`);
  process.exit(2);
}

// Minimal glob → regex: ** spans separators, * does not, ? is one char.
const globToRe = (g) => {
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { out += '.*'; i++; if (g[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
};

const dead = [];
const check = (p, where) => {
  if (!p || typeof p !== 'string') return;
  if (p.includes('*') || p.includes('?')) {
    const re = globToRe(p);
    if (!all.some((f) => re.test(f))) dead.push(`${where}: glob "${p}" matches NO file`);
  } else if (!fs.existsSync(path.join(ROOT, p))) {
    dead.push(`${where}: path "${p}" does not exist`);
  }
};

let entries = 0;
const visit = (node, where) => {
  if (Array.isArray(node)) { node.forEach((n, i) => visit(n, `${where}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  entries++;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && (k === 'doc' || k === 'marketingDoc')) check(v, `${where}.${k}`);
    else if (k === 'sourceGlobs' && Array.isArray(v)) v.forEach((g, i) => check(g, `${where}.sourceGlobs[${i}]`));
    else if (typeof v === 'object') visit(v, `${where}.${k}`);
  }
};
visit(map, 'map');

if (entries === 0) {
  console.error('FATAL: no entries walked in feature-doc-map.json. THE PARSER IS BROKEN.');
  process.exit(2);
}

console.log(`doc-map: ${entries} node(s) checked against ${all.length} files`);
if (dead.length) {
  console.error(`\ndoc-map FAILED — ${dead.length} reference(s) match nothing:\n`);
  for (const d of dead) console.error(`  - ${d}`);
  console.error('\nA glob that matches nothing cannot make the Stop hook fire. It fails open, silently.');
  process.exit(1);
}
console.log('doc-map OK — every referenced path resolves');
