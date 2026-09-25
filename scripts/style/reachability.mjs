// reachability.mjs - which src files the running app can actually reach.
//
// Walks the static and dynamic import graph from the renderer entry (src/main.tsx) and prints, per
// src/features module (same unit as style-divergence.mjs), how many of its production .tsx files are
// reachable. Written for the style-unification fleet phase after Module 4 was rebuilt before anyone
// noticed its dashboard was imported by no file (2026-09-25). A module the app cannot reach is not a
// revitalization target; it is a routing question for the owner.
//
//   node scripts/style/reachability.mjs [--json] [--entry src/main.tsx]
//
// Resolution: '@/x' -> src/x; relative paths; extensions .ts .tsx .js .mjs and index files. Both
// `import ... from '...'`, `export ... from '...'` and `import('...')` count. Type-only imports count
// too (conservative: they never make a file unreachable). Tests and stories are not entries.
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const argv = process.argv.slice(2);
const entry = argv.includes('--entry') ? argv[argv.indexOf('--entry') + 1] : 'src/main.tsx';
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const SPEC = /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function resolve(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(repo, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const e of EXT) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

const seen = new Set();
const queue = [path.join(repo, entry)];
while (queue.length) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  if (!/\.(tsx?|mjs|js)$/.test(f)) continue;
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(SPEC)) {
    const r = resolve(f, m[1] || m[2] || m[3]);
    if (r && !seen.has(r)) queue.push(r);
  }
}

function mod(rel) {
  const s = rel.split('/').slice(2), [ft, a, b] = s;
  if (s.length === 2) return ft + '/(root)';
  if (ft === 'shared') return s.length >= 4 ? `shared/${a}/${b}` : `shared/${a}/(root)`;
  if (a.startsWith('sub_')) return `${ft}/${a}`;
  if (s.length >= 4 && b.startsWith('sub_')) return `${ft}/${a}/${b}`;
  return `${ft}/${a}`;
}

const rows = {};
function walkFeatures(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walkFeatures(p); continue; }
    if (!e.name.endsWith('.tsx') || /\.(test|spec|stories)\./.test(e.name)) continue;
    const rel = path.relative(repo, p).split(path.sep).join('/');
    const m = mod(rel);
    const r = (rows[m] ??= { module: m, files: 0, reachable: 0, unreachable: [] });
    r.files++;
    if (seen.has(p)) r.reachable++; else r.unreachable.push(rel);
  }
}
walkFeatures(path.join(repo, 'src/features'));

const list = Object.values(rows).sort((a, b) => a.reachable / a.files - b.reachable / b.files);
if (seen.size < 500) {
  console.error(`reachability: walked only ${seen.size} files from ${entry} - the resolver is broken, not the app small`);
  process.exit(2);
}
if (argv.includes('--json')) {
  console.log(JSON.stringify({ entry, walked: seen.size, modules: list }, null, 1));
} else {
  const dead = list.filter((r) => r.reachable === 0);
  const partial = list.filter((r) => r.reachable > 0 && r.reachable < r.files);
  console.log(`walked ${seen.size} files from ${entry}; ${list.length} modules; ${dead.length} fully unreachable; ${partial.length} partly reachable`);
  for (const r of dead) console.log(`DEAD     ${r.module} (${r.files} tsx)`);
  for (const r of partial.slice(0, 40)) console.log(`PARTIAL  ${r.module} ${r.reachable}/${r.files}`);
}
