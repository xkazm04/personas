// The committed bytes of a vendored glyph ARE its source — so pin them.
//
// 13 files under src/ carry a machine-traced-art banner naming the shared
// ai-registry `motionize` skill as their generator. That skill is NOT tracked in
// this repo (`.claude/skills/motionize` is a link into ../ai-registry, absent from
// `git ls-files`), it is not one of the 14 tasks in scripts/run-codegen.mjs, and the
// source art it traced was never committed. So nothing in this checkout can
// re-derive any of them, and the largest — archetypeGlyphData.ts, 318KB across 12
// lines — is exactly the shape of file a reviewer's eyes slide off.
//
// That combination is the census rule `unverifiable-generated-artifact` in its worst
// form: a DO-NOT-EDIT promise with nothing behind it. But note that rule's roots are
// `scripts/` and its anchor is the GENERATOR, so it scores zero here — the generator
// lives in another repo. The condition it names is present; the proxy cannot see it.
//
// The legal fixes that rule enumerates all assume the generator is reachable
// (`--check` mode, compare-before-write, generate somewhere git does not track).
// None applies. What is left is the one property still worth having: a hand edit, a
// truncated write, or a half-finished re-trace must not be silently absorbed. This
// hashes each file and compares against a committed manifest, so any of those turns
// a silent diff into a red gate.
//
// Fail-loud contract, matching scripts/census/check-corpus-integrity.mjs: finding
// nothing and looking at nothing are different outcomes and only one is success.
// Zero candidates, or a walk that visits implausibly few files, exits 2 as a broken
// matcher rather than 0 as a clean repo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Derived from this file's location, never from cwd — see the note in
// scripts/docs/check-doc-map-paths.mjs about a hardcoded ROOT that aborted
// `npm run check`'s && chain on every machine but the author's.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'scripts/vendored-glyph-manifest.json');

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const CHECK = !UPDATE || argv.includes('--check');

/** The banner every vendored glyph carries on line 1. Anchored at offset 0. */
const BANNER = /^\/\/ VENDORED machine-traced art/;
/** The generator these artifacts name — a skill that is not in this repo. */
const GENERATOR = 'motionize';

let visited = 0;
const found = [];
const walk = (dir) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (['node_modules', '.git', 'dist', 'target'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.ts')) continue;
    visited++;
    const src = fs.readFileSync(p, 'utf8');
    if (!BANNER.test(src)) continue;
    if (!src.slice(0, 600).includes(GENERATOR)) continue;
    found.push({ rel: path.relative(ROOT, p).split(path.sep).join('/'), src });
  }
};
walk(path.join(ROOT, 'src'));

if (visited < 500) {
  console.error(`FATAL: walked only ${visited} .ts files under src/; expected thousands. THE WALKER IS BROKEN.`);
  process.exit(2);
}
// A check that finds nothing is assumed broken, not satisfied. If the glyphs were
// genuinely all deleted, delete this check and its manifest in the same commit.
// Keep the guard and its exit adjacent: the census rule `gate-without-empty-input-guard`
// looks for `.length === 0` within 220 chars of a non-zero `process.exit`, and it caught
// this file when the two were separated by a second console.error line.
if (found.length === 0) {
  console.error('FATAL: zero vendored-glyph artifacts matched — the matcher is broken.');
  process.exit(2);
}

// Hash line-ending-normalised content: this repo is developed on Windows and in CI,
// and a CRLF checkout must not read as a hand edit.
const digest = (src) => crypto.createHash('sha256').update(src.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const measured = Object.fromEntries(found.map((f) => [f.rel, digest(f.src)]).sort((a, b) => a[0].localeCompare(b[0])));

if (UPDATE) {
  fs.writeFileSync(MANIFEST, JSON.stringify({
    $comment: 'Content hashes of the vendored machine-traced glyph artifacts. Regenerate with `npm run check:glyphs -- --update` ONLY after a real re-trace through the ai-registry motionize skill — a hash that moves for any other reason is the hand edit this file exists to catch.',
    algorithm: 'sha256 over LF-normalised UTF-8',
    artifacts: measured,
  }, null, 2) + '\n');
  console.log(`vendored-glyphs: manifest rebaselined to ${found.length} artifacts.`);
  if (!argv.includes('--check')) process.exit(0);
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`FATAL: ${MANIFEST} missing — cannot check. Failing loudly.`);
  process.exit(2);
}
const pinned = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).artifacts ?? {};

const problems = [];
for (const [rel, hash] of Object.entries(measured)) {
  if (!(rel in pinned)) problems.push(`NEW      ${rel} — a vendored glyph with no pinned hash`);
  else if (pinned[rel] !== hash) problems.push(`CHANGED  ${rel}\n           pinned   ${pinned[rel]}\n           measured ${hash}`);
}
for (const rel of Object.keys(pinned)) {
  if (!(rel in measured)) problems.push(`GONE     ${rel} — pinned but no longer present (or its banner was removed)`);
}

if (problems.length > 0 && CHECK) {
  console.error(`vendored-glyphs: ${problems.length} problem(s) across ${found.length} artifacts.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThese files cannot be re-derived from this checkout — the committed bytes are the source.');
  console.error('If this is a real re-trace through the ai-registry `motionize` skill, run:');
  console.error('  npm run check:glyphs -- --update');
  console.error('and commit scripts/vendored-glyph-manifest.json alongside the art.');
  process.exit(1);
}

console.log(`vendored-glyphs: ${found.length} artifacts pinned and unchanged (${visited} .ts files visited).`);
