#!/usr/bin/env node
// Stop hook: when a turn edited source code that a published golden path
// governs, name the path and its §2 prescription before the turn ends.
//
// The corpus is 174 measured documents. Nothing in it reaches a session at the
// moment it matters, because the paths are found by someone remembering they
// exist. This closes that loop from the only side that can be automated: the
// files the corpus already cites.
//
// Architecture is deliberately IDENTICAL to scripts/docs/check-doc-sync.mjs —
// same stdin payload, same stop_hook_active guard, same transcript walk, same
// skip-pattern filter, same exit-2-with-a-dismissal-contract. A second hook
// that behaved differently would be a second thing to learn.
//
// WHAT MAKES IT FIRE: the edited path appears in router.json's `byFile`, which
// means some golden path cites that exact file. It is not a glob, not a
// heuristic, and not a directory rule — the corpus either discussed this file or
// it did not. That is why the false-positive rate is a property of the corpus
// rather than of this script.
//
// Dismiss path: reply with one short sentence confirming §2 compliance or
// naming the deviation, and stop. Same interaction contract as doc-sync.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ROUTER_PATH = path.join(REPO_ROOT, 'docs/concepts/golden-paths/router.json');
const INDEX_PATH = path.join(REPO_ROOT, 'docs/concepts/golden-paths/index.json');

const MAX_PATHS = 3;
const MAX_FILES_PER_PATH = 2;

// Unconditional skips, on top of "must be in router.byFile".
//
// The first four exist so the LIVE COMPOSITION WAVE never sees this hook. That
// session edits golden paths, rules.json, and the census scripts all day; a
// nag on every one of those turns would be pure noise and the first fix anyone
// reached for would be to delete the hook. Asserted directly in the fixture
// tests ("the wave session's edit set is silent").
const SKIP_PATTERNS = [
  /\.md$/,
  /^docs\//,
  /^scripts\/census\//,
  /^scripts\/docs\//,
  /^src\/lib\/bindings\//,
  /^src\/i18n\/locales\//,
  /^src\/i18n\/section-locales\//,
  /(^|\/)__tests__\//,
  /\.test\.[a-z]+$/,
  /\.spec\.[a-z]+$/,
  /\.gen\.[a-z]+$/,
  /\.generated\.[a-z]+$/,
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalize(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

function collectEditedFilesFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const edited = new Set();
  // Walk backwards to the most recent user message; everything after it is
  // this turn.
  for (let i = lines.length - 1; i >= 0; i--) {
    const evt = safeJson(lines[i]);
    if (!evt) continue;
    if (evt.type === 'user' && evt.message?.role === 'user') break;
    if (evt.type !== 'assistant') continue;
    const content = evt.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp === 'string' && fp.length) edited.add(normalize(fp));
    }
  }
  return edited;
}

/** First sentence of the §2 prescription, for the one-line summary. */
function firstSentence(text, capAt = 320) {
  if (!text) return '';
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : text).trim();
  return s.length > capAt ? s.slice(0, capAt - 1).trimEnd() + '…' : s;
}

function main() {
  const payload = safeJson(readStdin()) || {};
  if (payload.stop_hook_active) process.exit(0);

  const edited = collectEditedFilesFromTranscript(payload.transcript_path);
  if (edited.size === 0) process.exit(0);

  const candidates = [...edited].filter((f) => !SKIP_PATTERNS.some((re) => re.test(f)));
  if (candidates.length === 0) process.exit(0);

  // A missing or unparseable router is an INFRASTRUCTURE absence, not a
  // finding. Freshness is enforced upstream — merge-published-rules.mjs
  // regenerates it, predev/prebuild regenerate it, check-corpus-integrity
  // reports staleness. A hook that hard-failed here would nag every single turn
  // for a reason that has nothing to do with the turn, and the first fix anyone
  // reached for would be to unregister the hook. So: one line, exit 0.
  let router;
  try {
    router = JSON.parse(fs.readFileSync(ROUTER_PATH, 'utf8'));
  } catch {
    process.stderr.write(
      'golden-path router unavailable (docs/concepts/golden-paths/router.json) — ' +
      'run `node scripts/census/build-golden-path-index.mjs`. Not blocking.\n',
    );
    process.exit(0);
  }
  if (!router || typeof router.byFile !== 'object' || router.byFile === null) {
    process.stderr.write('golden-path router has no byFile map — not blocking.\n');
    process.exit(0);
  }

  // leaf -> { count, files: Set }
  const hits = new Map();
  for (const f of candidates) {
    const entries = router.byFile[f];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!hits.has(e.leaf)) hits.set(e.leaf, { count: 0, files: new Map() });
      const h = hits.get(e.leaf);
      h.count += e.count ?? 1;
      h.files.set(f, { count: e.count ?? 1, sections: e.sections ?? [] });
    }
  }
  if (hits.size === 0) process.exit(0);

  // index.json carries the per-(leaf, file) prose snippet. It is 4.4 MB, so it
  // is opened only now — once the hook has already decided to fire — and its
  // absence degrades the message rather than suppressing it.
  let index = null;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch { /* optional detail */ }

  const ranked = [...hits.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, MAX_PATHS);

  const blocks = shown.map(([leaf, h]) => {
    const meta = router.leaves?.[leaf] ?? {};
    const one = firstSentence(meta.oneWay || '');
    const head = one ? `${leaf} — §2: ${one}` : leaf;
    const doc = meta.doc ? `\n    ${meta.doc}` : '';

    const files = [...h.files.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, MAX_FILES_PER_PATH);

    const fileLines = files.map(([f, info]) => {
      const secs = info.sections.length ? ` (§${info.sections.join(' §')})` : '';
      const ctx = index?.docs?.[leaf]?.citations?.[f]?.contexts?.[0];
      return `    - ${f}${secs}` + (ctx ? `\n        ${ctx}` : '');
    }).join('\n');

    const more = h.files.size > files.length ? `\n    …and ${h.files.size - files.length} more file(s)` : '';
    return `  - ${head}${doc}\n${fileLines}${more}`;
  }).join('\n\n');

  const overflow = ranked.length > shown.length
    ? `\n\n(${ranked.length - shown.length} further golden path(s) also cite these files.)`
    : '';

  process.stderr.write(
    `This turn edited files governed by golden path(s):\n\n${blocks}${overflow}\n\n` +
    `Each path's §2 is the ONE prescribed way for that situation, measured against this repo. ` +
    `Read it before you consider the edit finished.\n\n` +
    `Dismiss path: reply with one short sentence — either confirming the edit follows §2, ` +
    `or naming the deviation and why it is right here — and stop.\n`,
  );
  process.exit(2);
}

main();
