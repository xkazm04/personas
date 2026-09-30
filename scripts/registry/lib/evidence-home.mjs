// The tracked home of the consumer-side layer: docs/evidence/<subject>.md.
//
// A golden path published to the registry is the STANDARD. How THIS codebase measures
// against it - the files that witness it (evidence), the files that break it
// (counter_evidence), and the anchors into docs/concepts/golden-path-deferred-fixes.md
// (deviations) - is meaningless anywhere else, so it never publishes (rkb-profile
// section 5) and it cannot live in the registry clone's gitignored sidecars either:
// those are a local convenience, not an archive. This directory is the archive.
//
// One file per subject slug (identity is the slug, not the taxonomy path, which moves
// with the registry). The frontmatter keeps the trailing `# comment` on each pointer:
// the comment is the teaching value.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitDoc, isTopLevelKey, listValues } from './frontmatter.mjs';

export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
export const EVIDENCE_DIR = path.join(ROOT, 'docs/evidence');
export const EVIDENCE_KEYS = ['evidence', 'counter_evidence', 'deviations'];

/** Slugs that have an evidence file, sorted. Empty array when the directory is absent. */
export const evidenceSlugs = (dir = EVIDENCE_DIR) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
        .map((f) => f.replace(/\.md$/, ''))
        .sort()
    : [];

/** `{ evidence[], counter_evidence[], deviations[] }` for one slug, or null when it has no file. */
export const readEvidence = (slug, dir = EVIDENCE_DIR) => {
  const file = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const split = splitDoc(fs.readFileSync(file, 'utf8'));
  if (!split) return null;
  const out = { subject: null };
  for (const key of EVIDENCE_KEYS) out[key] = listValues(split.fmLines, key);
  const line = split.fmLines.find((l) => l.startsWith('subject:'));
  out.subject = line ? line.slice('subject:'.length).trim() : null;
  return out;
};

/** The verbatim frontmatter block (comments and all) for `key`, as an array of lines. */
export const keyBlock = (fmLines, key) => {
  const start = fmLines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return [];
  let end = start + 1;
  while (end < fmLines.length && !isTopLevelKey(fmLines[end])) end += 1;
  // Drop trailing blank lines so the emitted file is stable.
  while (end > start + 1 && fmLines[end - 1].trim() === '') end -= 1;
  return fmLines.slice(start, end);
};
