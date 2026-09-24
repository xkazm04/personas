#!/usr/bin/env node
/**
 * Eager-bytes instrument (M1): how much JavaScript the app must fetch, parse
 * and evaluate before first paint.
 *
 * Walks a production `dist/` from the entry chunk through STATIC import edges
 * only (`import ... from "./x.js"` and side-effect `import "./x.js"`). Dynamic
 * `import("./x.js")` edges are lazy by definition and are not followed, so the
 * result is the closure the browser loads eagerly for the entry module.
 *
 * The entry is the `<script type="module" src=".../index-*.js">` named in
 * `dist/index.html`; when that file is missing it falls back to the first
 * `assets/index-*.js`.
 *
 * Usage:
 *   node scripts/perf/eager-bytes.mjs                  # dist/ in the repo root
 *   node scripts/perf/eager-bytes.mjs --dist <path>    # any built dist folder
 *   node scripts/perf/eager-bytes.mjs --json           # machine-readable
 *   node scripts/perf/eager-bytes.mjs --top 15         # list the N largest eager chunks
 *
 * Build first (`npm run build`; `npx vite build` alone skips codegen).
 * Exit code 1 when the dist or its entry chunk cannot be found.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { dist: path.join(REPO_ROOT, 'dist'), json: false, top: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dist') args.dist = path.resolve(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--top') args.top = Number(argv[++i]) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: eager-bytes.mjs [--dist PATH] [--json] [--top N]');
      process.exit(0);
    }
  }
  return args;
}

/** Static import specifiers of one built chunk, relative to its own folder. */
const STATIC_IMPORT = /import\s*(?:[\w*{}\s,$]*?from\s*)?["']\.\/([^"']+?\.js)["']/g;

function findEntry(dist) {
  const html = path.join(dist, 'index.html');
  if (fs.existsSync(html)) {
    const m = /<script[^>]+type="module"[^>]+src="\.?\/?assets\/([^"]+\.js)"/.exec(fs.readFileSync(html, 'utf8'));
    if (m) return m[1];
  }
  const assets = path.join(dist, 'assets');
  if (!fs.existsSync(assets)) return null;
  return fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f)) ?? null;
}

function walk(assets, entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    const file = path.join(assets, f);
    if (!fs.existsSync(file)) continue;
    seen.add(f);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(STATIC_IMPORT)) queue.push(m[1]);
  }
  return [...seen].map((f) => ({ file: f, bytes: fs.statSync(path.join(assets, f)).size }));
}

function main() {
  const args = parseArgs(process.argv);
  const assets = path.join(args.dist, 'assets');
  const entry = findEntry(args.dist);
  if (!entry) {
    console.error(`eager-bytes: no entry chunk under ${args.dist} (run \`npm run build\` first)`);
    process.exit(1);
  }
  const chunks = walk(assets, entry).sort((a, b) => b.bytes - a.bytes);
  const totalBytes = chunks.reduce((s, c) => s + c.bytes, 0);
  const builtAt = fs.statSync(path.join(assets, entry)).mtime.toISOString();
  const result = { dist: args.dist, entry, builtAt, chunkCount: chunks.length, totalBytes, chunks };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
  console.log(`dist:    ${args.dist}`);
  console.log(`entry:   ${entry} (built ${builtAt})`);
  console.log(`eager:   ${chunks.length} chunks, ${totalBytes.toLocaleString('en-US')} B (${kb(totalBytes)})`);
  if (args.top > 0) {
    console.log(`\nlargest ${Math.min(args.top, chunks.length)}:`);
    for (const c of chunks.slice(0, args.top)) console.log(`  ${kb(c.bytes).padStart(11)}  ${c.file}`);
  }
}

main();
