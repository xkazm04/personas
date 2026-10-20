#!/usr/bin/env node
/**
 * check-relative-links.mjs — every relative link in the repo's guidance resolves.
 *
 * The guidance files are the first thing a contributor or an agent reads, and
 * they drift quietly: on 2026-10-10 CONTRIBUTING.md still pointed at
 * `ARCHITECTURE.md` and `docs/DEVELOPMENT.md`, neither of which existed, and
 * walked a fork-and-PR flow that AGENTS.md and ci.yml had long replaced.
 * Nothing noticed, because nothing followed the links.
 *
 * Checked: inline markdown links and images `[text](target)` whose target is
 * relative (no scheme). The file part must exist (file or directory), and a
 * `#fragment` into a markdown file must match one of its heading slugs (GitHub's
 * rule: lowercase, punctuation dropped, each space a hyphen, `-N` for repeats).
 * Fenced code blocks and inline code spans are skipped.
 *
 * Not checked: http(s)/mailto links (no network), reference-style links, and
 * targets under `.claude/skills/`. Shared skills there are links into the
 * organisation's AI registry (`.ai/manifest.yaml` `skills:`); they resolve in a
 * machine's linked checkout and not in a bare clone such as CI, so a check over
 * them would answer differently per machine.
 *
 * Run by `src/__tests__/structural/doc-relative-links.test.ts`, so it fails
 * `npm test`.
 *
 * Usage:
 *   node scripts/docs/check-relative-links.mjs            # list broken links, exit 1 if any
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The guidance an agent or contributor reads first. Repo-relative, posix. */
export const GUIDANCE_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'CLAUDE.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.claude/CLAUDE.md',
];

const SKIPPED_TARGET_PREFIXES = ['.claude/skills/'];

const LINK = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Blank fenced code blocks, keeping line numbers; with `inline`, also drop
 * inline code spans (a link quoted in backticks is prose, not a link).
 */
export function stripCode(markdown, { inline = true } = {}) {
  const lines = markdown.split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
        return '';
      }
      if (open) {
        fence = open[1];
        return '';
      }
      return inline ? line.replace(/`+[^`]*`+/g, '') : line;
    })
    .join('\n');
}

/** GitHub's heading anchors for one markdown document. */
export function headingSlugs(markdown) {
  const seen = new Map();
  const slugs = new Set();
  // GitHub keeps the text of an inline code span in the anchor (its backticks
  // are dropped as punctuation), so only fenced blocks are skipped here.
  for (const line of stripCode(markdown, { inline: false }).split('\n')) {
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1]
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

/** Every relative link in one markdown source, as `{ line, target }`. */
export function linksIn(markdown) {
  const out = [];
  const code = stripCode(markdown);
  for (const m of code.matchAll(LINK)) {
    const target = m[1].replace(/^<|>$/g, '');
    if (SCHEME.test(target)) continue;
    out.push({ line: code.slice(0, m.index).split('\n').length, target });
  }
  return out;
}

function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    // intentional: a missing path is the "not a file" answer, reported by the caller
    return false;
  }
}

/** Why `target`, written in `fromRel`, does not resolve; null when it does. */
export function problemWith(root, fromRel, target) {
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart.split('?')[0]);
  } catch {
    // intentional: an undecodable target is itself the defect being reported
    return 'target is not valid percent-encoding';
  }
  const rel = decoded === '' ? fromRel : posix.normalize(posix.join(posix.dirname(fromRel), decoded));
  if (rel.startsWith('..')) return 'target escapes the repository';
  if (SKIPPED_TARGET_PREFIXES.some((p) => rel.startsWith(p))) return null;
  const abs = join(root, rel);
  if (!existsSync(abs)) return `${rel} does not exist`;
  if (fragment && rel.toLowerCase().endsWith('.md') && isFile(abs)) {
    const slug = decodeURIComponent(fragment).toLowerCase();
    if (!headingSlugs(readFileSync(abs, 'utf8')).has(slug)) return `${rel} has no heading #${fragment}`;
  }
  return null;
}

/** Walk the guidance files and report every broken relative link. */
export function measure(root = ROOT, files = GUIDANCE_FILES) {
  const broken = [];
  let filesSeen = 0;
  let linksSeen = 0;
  for (const file of files) {
    const abs = join(root, file);
    if (!isFile(abs)) {
      broken.push({ file, line: 0, target: '', problem: 'guidance file is missing' });
      continue;
    }
    filesSeen += 1;
    for (const { line, target } of linksIn(readFileSync(abs, 'utf8'))) {
      linksSeen += 1;
      const problem = problemWith(root, file, target);
      if (problem) broken.push({ file, line, target, problem });
    }
  }
  return { filesSeen, linksSeen, broken };
}

function main() {
  const { filesSeen, linksSeen, broken } = measure();
  console.log(`relative links: ${filesSeen} guidance files, ${linksSeen} relative links, ${broken.length} broken.`);
  for (const b of broken) console.error(`  ${b.file}:${b.line}  (${b.target})  ${b.problem}`);
  if (broken.length > 0) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) main();
