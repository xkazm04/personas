#!/usr/bin/env node
/**
 * extract-evidence - move the consumer-side layer out of docs/concepts/paths/ into
 * docs/evidence/<subject>.md (see scripts/registry/lib/evidence-home.mjs for why).
 *
 * Mechanical and idempotent: every `evidence:`, `counter_evidence:` and `deviations:`
 * block is copied VERBATIM (trailing `# comment` included) from
 * `docs/concepts/paths/**\/<slug>/<slug>.md`. Nothing is hand-copied.
 *
 * Usage:
 *   node scripts/registry/extract-evidence.mjs            write missing files, refuse to overwrite a differing one
 *   node scripts/registry/extract-evidence.mjs --force    overwrite differing files
 *   node scripts/registry/extract-evidence.mjs --check    write nothing; exit 1 if docs/evidence differs from paths/
 *   node scripts/registry/extract-evidence.mjs --json     machine-readable totals
 *
 * The comparison is by parsed value (evidence/counter/deviation lists), so a comment edit
 * in docs/evidence is drift only in --check when the VALUES differ; comments are the
 * evidence layer's own prose from here on.
 */

import fs from 'node:fs';
import path from 'node:path';

import { splitDoc, scalarValue, listValues } from './lib/frontmatter.mjs';
import { ROOT, EVIDENCE_DIR, EVIDENCE_KEYS, keyBlock, readEvidence, evidenceSlugs } from './lib/evidence-home.mjs';

const CORPUS = path.join(ROOT, 'docs/concepts/paths');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);

const die = (msg) => {
  console.error(`extract-evidence FATAL: ${msg}`);
  process.exit(2);
};

if (!fs.existsSync(CORPUS)) {
  die(
    `no corpus at ${path.relative(ROOT, CORPUS)}. If paths/ has already been deleted (migration P4), ` +
      `docs/evidence/ IS the source and this script has nothing left to extract.`,
  );
}

/** Same rule as scripts/lib/taxonomy.mjs::walkSubjects: <name>/<name>.md is a subject at any depth. */
const subjects = new Map();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const abs = path.join(dir, e.name);
    if (fs.existsSync(path.join(abs, `${e.name}.md`))) {
      if (subjects.has(e.name)) die(`duplicate subject slug "${e.name}" - identity is the slug`);
      subjects.set(e.name, path.join(abs, `${e.name}.md`));
    } else if (e.name !== 'techniques' && e.name !== 'applications') {
      walk(abs);
    }
  }
};
walk(CORPUS);
if (subjects.size === 0) {
  console.error('extract-evidence FATAL: walked zero subjects. THE WALKER IS BROKEN, not the corpus.');
  process.exit(2);
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const totals = { subjects: subjects.size, evidence: 0, counter_evidence: 0, deviations: 0 };
const written = [];
const unchanged = [];
const refused = [];
const drift = [];

const title = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

for (const [slug, file] of [...subjects].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const split = splitDoc(fs.readFileSync(file, 'utf8'));
  if (!split) die(`${path.relative(ROOT, file)}: no frontmatter block`);

  const lines = [`subject: ${slug}`];
  const category = scalarValue(split.fmLines, 'category');
  for (const key of EVIDENCE_KEYS) {
    const block = keyBlock(split.fmLines, key);
    lines.push(...(block.length ? block : [`${key}: []`]));
  }
  const body =
    `\n# ${title(slug)} - evidence\n\n` +
    `How this codebase measures against the [\`${slug}\`](https://github.com/xkazm04/ai-registry) golden path` +
    `${category ? ` (${category})` : ''}. The standard lives in the registry; this file is the ` +
    `consumer-side layer and is edited here. Deviation anchors resolve in ` +
    `[golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).\n`;
  const text = `---\n${lines.join('\n')}\n---\n${body}`;

  const src = {};
  for (const key of EVIDENCE_KEYS) {
    const v = listValues(splitDoc(text).fmLines, key);
    src[key] = v;
    totals[key] += v.length;
  }

  const dest = path.join(EVIDENCE_DIR, `${slug}.md`);
  const have = readEvidence(slug);
  if (have) {
    const equal = EVIDENCE_KEYS.every((k) => same(have[k], src[k]));
    if (equal) {
      unchanged.push(slug);
      continue;
    }
    drift.push(slug);
    if (!flag('--force')) {
      refused.push(slug);
      continue;
    }
  } else {
    drift.push(slug);
  }
  if (flag('--check')) continue;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(dest, text);
  written.push(slug);
}

// Orphans: a file in docs/evidence with no subject in paths/ is only an error while paths/ is the source.
const orphans = evidenceSlugs().filter((s) => !subjects.has(s));

if (flag('--json')) {
  console.log(JSON.stringify({ ...totals, written: written.length, unchanged: unchanged.length, drift, refused, orphans }));
} else {
  console.log(
    `evidence: ${totals.subjects} subjects - ${totals.evidence} evidence, ${totals.counter_evidence} counter-evidence, ` +
      `${totals.deviations} deviations`,
  );
  console.log(`  written ${written.length} - unchanged ${unchanged.length} - drift ${drift.length} - orphans ${orphans.length}`);
  for (const s of refused) console.error(`  REFUSED (differs, pass --force): docs/evidence/${s}.md`);
  for (const s of orphans) console.error(`  ORPHAN: docs/evidence/${s}.md has no subject in paths/`);
}

if (flag('--check') && (drift.length || orphans.length)) process.exit(1);
if (refused.length) process.exit(1);
