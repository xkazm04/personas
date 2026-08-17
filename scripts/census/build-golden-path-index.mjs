#!/usr/bin/env node
// Golden-path corpus index + router.
//
// WHAT THIS IS FOR. The corpus is 175 documents and roughly 190,000 words of
// measured prescription. Nothing in it is reachable at the moment a session is
// about to edit a file it governs — the paths are found by a human remembering
// they exist. This generator turns the prose into two machine artifacts:
//
//   docs/concepts/golden-paths/index.json   leaf-major: per document, its
//     headline, its §2 prescription, its deviation one-liners, the census rule
//     ids it published, and every code-file it cites with the section and the
//     line of prose that cited it.
//   docs/concepts/golden-paths/router.json  file-major: the same citations
//     inverted, so "which paths govern src/features/x/Y.tsx" is a lookup.
//
// The consumers are `--prime` (brief priming, human/agent-facing) and
// scripts/docs/check-golden-path-touch.mjs (the Stop hook). Neither can exist
// without the inversion; both are cheap once it does.
//
// DETERMINISM IS THE CONTRACT. No timestamps, no commit hashes, sorted keys,
// LF line endings. `--check` is therefore a byte comparison, which is the only
// kind of freshness check that cannot drift on a rerun. Anything that made the
// output depend on the clock would turn `--check` into a permanent red.
//
// ─────────────────────────────────────────────────────────────────────────
// THE INSTRUMENT IS ASSERTED BEFORE THE RESULT (doctrine §2).
//
// A parser over 175 hand-written documents fails silently by construction: a
// heading convention shifts, a section vanishes from the extraction, and the
// artifact still writes, still validates, still looks complete. The corpus has
// already paid for this twice — check-csp-hosts.mjs reported ZERO fetch hosts
// twice for two unrelated reasons, and a CRLF rewrite made the fence merger see
// ZERO blocks, where "a lost rule looks exactly like a rule nobody wrote".
//
// So: floors, hard-coded at ~80% of a real measurement (recorded below), and a
// per-document guard — a doc that yields NO citations AND NO trigger lines is
// treated as a parse failure, not as a quiet document, because those two
// outcomes are indistinguishable from the outside and only one of them is
// benign. Plus a cross-artifact inventory in BOTH directions against
// rules.json, which is the check that would have caught the CRLF fence loss.
//
// Usage:
//   node scripts/census/build-golden-path-index.mjs              write both artifacts
//   node scripts/census/build-golden-path-index.mjs --check      byte-compare, exit 1 on drift
//   node scripts/census/build-golden-path-index.mjs --prime <file...>
//   node scripts/census/build-golden-path-index.mjs --prime-diff

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractPublishedRules, normalizeEol } from './lib/instruments/extractFences.mjs';

// Derived from this file's own location, never hardcoded — check-corpus-integrity.mjs
// shipped with an absolute path to one laptop and aborted `npm run check` everywhere else.
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

// FAULT-INJECTION OVERRIDE — used by __tests__/build-golden-path-index.test.mjs
// and by nothing else.
//
// It exists because the alternative is worse. The obvious way to test a
// generator's failure modes is to string-rewrite its path constants into a copy
// and run the copy — but then the thing under test is not the thing that ships,
// which is exactly the doctrine's "a test that runs on one side of a boundary is
// a third copy, not a check". This override lets the REAL script, with the REAL
// floors, run against a deliberately broken corpus.
//
// It announces itself on stderr every time, so a run against the wrong tree can
// never be mistaken for a run against this one.
const CORPUS_OVERRIDE = process.env.GP_INDEX_CORPUS_DIR;
if (CORPUS_OVERRIDE) {
  process.stderr.write(`[build-golden-path-index] CORPUS OVERRIDE ACTIVE: ${CORPUS_OVERRIDE} — this is NOT the repo corpus.\n`);
}

const PATHS_DIR = CORPUS_OVERRIDE
  ? path.resolve(CORPUS_OVERRIDE)
  : path.join(ROOT, 'docs/concepts/golden-paths');
const RULES = path.join(ROOT, 'scripts/census/rules.json');
const INDEX_OUT = path.join(PATHS_DIR, 'index.json');
const ROUTER_OUT = path.join(PATHS_DIR, 'router.json');

// Files in golden-paths/ that are not golden paths. Mirrors
// check-corpus-integrity.mjs's NOT_A_PATH; an unexplained entry here is how a
// real gap hides.
const NOT_A_PATH = new Set(['REVIEW-wave1.md']);

// ─────────────────────────────────────────────────────── floors
// MEASURED 2026-08-17 at HEAD over the real corpus, then set to ~80%.
// These are not guesses. Re-measure and re-set them deliberately if the corpus
// shrinks for a real reason; do NOT lower one to make a red run go green.
//
//   docs parsed ..................... 174     → floor 139
//   citations extracted ............. 26,004  → floor 20,803
//   distinct cited files (router) ... 2,834   → floor 2,267
//   docs with zero citations ........ 0       → ceiling 8
//   min citations in any one doc .... 60      (median 142, max 277)
//
// Resolution, for the record: 1,158 of the 26,004 citations are directories or
// globs (`src/`, `src-tauri/**`) and cannot resolve to a file by construction.
// Of the 24,846 that name a file, 19,579 resolve — **78.8%**. The 5,267 that do
// not are overwhelmingly AMBIGUOUS BASENAMES (`lib.rs` ×220, `executions.rs`
// ×100, `mod.rs` ×82, `Cargo.toml` ×58), which this generator deliberately
// refuses to guess at: a router entry pointing at the wrong file fires a hook on
// a path the corpus never discussed, which is worse than a missing one.
const FLOOR_DOCS = 139;
const FLOOR_CITATIONS = 20803;
const FLOOR_DISTINCT_FILES = 2267;
const CEILING_ZERO_CITATION_DOCS = 8;

// ─────────────────────────── rules that cannot be re-derived from their doc
//
// MEASURED 2026-08-17. Seven registered census rules cannot be re-extracted by
// `merge-published-rules.mjs` from the document that owns them, so for these
// seven the doctrine's own instruction — "after any programmatic edit to a
// finished path, re-extract the fence and confirm the rule count" — returns
// ZERO, which is exactly the reading a LOST rule produces.
//
// Every entry carries its reason, mirroring the census's own exclude-with-a-
// reason discipline (`validateRule` rejects an exclusion without one, and
// `assertRule` fails a STALE exclusion). Both directions are enforced below: a
// rule missing from its doc that is NOT listed here is fatal, and a rule listed
// here that starts extracting is ALSO fatal, because an allowlist nobody prunes
// is where violations go to hide.
//
// The fix is one character in four documents (```jsonc -> ```json) plus a
// published fence in three wave-1 documents. It is not applied here: those
// files belong to the live composition wave.
const RULES_WITHOUT_EXTRACTABLE_FENCE = {
  'raw-web-storage': 'client-state-persistence.md publishes NO fenced json at all (wave-1, predates the publish-a-fence convention); the rule was hand-added to rules.json',
  'hand-rolled-spinner': 'inline-busy-state.md publishes NO fenced json at all (wave-1); rule hand-added',
  'raw-select': 'dropdown-and-select.md publishes NO fenced json at all (wave-1); rule hand-added',
  'raw-react-lazy': 'lazy-route-chunk.md publishes the rule in a ```jsonc fence, which the merger does not read (it matches the info string exactly). The block DOES parse as JSON — one character fixes it',
  'local-empty-state': 'empty-and-demo-states.md publishes the rule in a ```jsonc fence (parses as JSON — one character fixes it)',
  'deferred-read-then-write': 'transaction-boundary.md publishes the rule in a ```jsonc fence (parses as JSON — one character fixes it)',
  'silent-row-skip': 'row-to-struct-mapping.md publishes the rule in a ```jsonc fence that does NOT parse as JSON (it carries comments), so this rule is unreproducible from its own document until the block is rewritten',
};

const CODE_EXTENSIONS = [
  '.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.css', '.scss',
  '.sql', '.toml', '.yml', '.yaml', '.sh', '.ps1', '.json', '.html',
];

// ─────────────────────────────────────────────────────── heading → section №
// Three heading conventions coexist in the corpus and all three are legitimate:
// 104 docs write `## 1. Trigger`, 40 write `## 1 Trigger`, 30 write `## Trigger`
// with no number at all, and exactly one (adding-a-ci-gate.md) has no `##` in it
// and numbers its `### N — …` headings inside a blockquote.
//
// A parser that knows only the numbered form silently drops a fifth of the
// corpus, which is precisely the failure the floors above exist to catch. The
// title map is derived from the CONTRACT's own nine-section table, not invented.
const TITLE_TO_SECTION = [
  [/headline/i, 0],
  [/^trigger\b/i, 1],
  [/one way/i, 2],
  [/mandated primitive/i, 3],
  [/^steps\b/i, 4],
  [/anti[- ]?pattern/i, 5],
  [/^evidence\b/i, 6],
  [/deviation/i, 7],
  [/^gaps?\b/i, 8],
  [/missing gate/i, 9],
  [/correction/i, 12],
];

function sectionNumberFor(title) {
  const numbered = title.match(/^(\d{1,2})\s*(?:[.)::]|[—–-])?\s+/);
  if (numbered) return Number(numbered[1]);
  for (const [re, n] of TITLE_TO_SECTION) if (re.test(title)) return n;
  return null;
}

// ─────────────────────────────────────────────────────── markdown helpers

/** Blank fenced code blocks, preserving line count so line numbers stay true. */
function blankFences(md) {
  return md.replace(/^[ \t]*>?[ \t]*```[\s\S]*?^[ \t]*>?[ \t]*```[ \t]*$/gm, (m) =>
    m.split('\n').map(() => '').join('\n'),
  );
}

/** Strip inline markdown emphasis/link syntax for a one-line summary. */
function plainText(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cap(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

/**
 * Split a document into sections.
 * Returns { sections: Map<number, {title, startLine, endLine, body}>, headings: [...] }
 * Lines are 1-based and refer to the ORIGINAL document.
 */
function parseSections(md) {
  const lines = md.split('\n');
  const headingRe = /^[ \t]*>?[ \t]*(#{2,3})[ \t]+(.+?)[ \t]*$/;
  const all = [];
  lines.forEach((line, i) => {
    const m = line.match(headingRe);
    if (m) all.push({ level: m[1].length, title: m[2].trim(), line: i + 1 });
  });

  // Prefer H2 as the section level. Fall back to H3 only when a document has no
  // H2 at all (adding-a-ci-gate.md is the single case in the corpus today).
  const h2 = all.filter((h) => h.level === 2);
  const chosen = h2.length >= 3 ? h2 : all.filter((h) => h.level === (h2.length ? 2 : 3));

  const sections = new Map();
  const ordered = [];
  chosen.forEach((h, idx) => {
    const start = h.line;
    const end = idx + 1 < chosen.length ? chosen[idx + 1].line - 1 : lines.length;
    const num = sectionNumberFor(h.title);
    const entry = { num, title: h.title, startLine: start, endLine: end };
    ordered.push(entry);
    if (num !== null && !sections.has(num)) {
      sections.set(num, { ...entry, body: lines.slice(start, end).join('\n') });
    }
  });
  return { sections, ordered, lines };
}

/** First non-empty paragraph of a body, as plain text. */
function firstParagraph(body) {
  const lines = body.split('\n');
  const out = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.replace(/^[ \t]*>[ \t]?/, '');
    const t = line.trim();
    if (!started) {
      if (!t || /^---+$/.test(t) || /^#{1,6}\s/.test(t)) continue;
      started = true;
      out.push(t);
      continue;
    }
    if (!t || /^#{1,6}\s/.test(t) || /^```/.test(t) || /^\|/.test(t) || /^---+$/.test(t)) break;
    out.push(t);
  }
  return plainText(out.join(' '));
}

/**
 * Deviation one-liners from §7: subsection titles first (the `### D1 — …` form
 * 78 docs use), falling back to bold lead-ins for the documents that write §7 as
 * a flat list of bolded claims.
 */
function extractDeviations(body) {
  const out = [];
  const subs = [...body.matchAll(/^[ \t]*>?[ \t]*#{3,4}[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]);
  for (const s of subs) out.push(cap(plainText(s), 200));
  if (out.length === 0) {
    for (const m of body.matchAll(/^[ \t]*>?[ \t]*(?:[-*][ \t]+)?\*\*(.+?)\*\*/gm)) {
      const t = cap(plainText(m[1]), 200);
      if (t.length > 3) out.push(t);
    }
  }
  const seen = new Set();
  return out.filter((s) => (seen.has(s) ? false : (seen.add(s), true))).slice(0, 12);
}

/** Verbatim bullet lines of §1. */
function extractTriggers(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const t = line.replace(/^[ \t]*>[ \t]?/, '').trim();
    if (/^[-*][ \t]+/.test(t)) out.push(t.replace(/^[-*][ \t]+/, ''));
  }
  return out.slice(0, 12);
}

// ─────────────────────────────────────────────────────── citations

const LINE_SUFFIX = /:(\d+(?:\s*[-,]\s*\d+)*)$/;

/**
 * Does this inline-code token look like a reference to a code file in this repo?
 *
 * The qualifying test is derived from the tree, not from imagination — the
 * doctrine's warning about vocabulary-based signals ("its precision is bounded
 * by the same list… `username` and `operator` went into the actor vocabulary
 * from imagination, before reading the bindings") applies exactly here. The
 * repo-root set comes from `git ls-files`, so it is whatever this checkout
 * actually contains.
 */
function classifyCitation(token, repoRoots) {
  let raw = token.trim();
  if (!raw || /\s/.test(raw)) return null;
  if (/^(https?|mailto):/i.test(raw)) return null;
  // `:` and `,` are IN this class deliberately: they are the line-suffix
  // delimiters (`Foo.tsx:205,310`). Leaving them out — which the first draft of
  // this function did — rejected every `file:line` citation in the corpus and
  // dropped entity-picker.md from 265 candidates to 29. Same family as the
  // doctrine's "enumerate the operators that contain your delimiters": the
  // instrument answered a different question than the one asked, and the answer
  // looked plausible because the survivors were all real.
  if (!/^[A-Za-z0-9_@.\-/*#$!{}[\]~:,]+$/.test(raw)) return null;

  let lines = null;
  const lm = raw.match(LINE_SUFFIX);
  if (lm) { lines = lm[1].replace(/\s+/g, ''); raw = raw.slice(0, lm.index); }
  if (!raw) return null;

  const file = raw.replace(/^\.\//, '').split('\\').join('/');
  if (!file || file === '.' || file === '..') return null;

  const last = file.slice(file.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  const ext = dot > 0 ? last.slice(dot).toLowerCase() : '';

  // corpus-integrity owns markdown links; a .md reference here would just be a
  // second, weaker copy of a check that already exists.
  if (ext === '.md' || ext === '.markdown') return null;

  const hasCodeExt = CODE_EXTENSIONS.includes(ext);
  const firstSeg = file.split('/')[0];
  const rootish = file.includes('/') && repoRoots.has(firstSeg);
  const elided = file.includes('...');

  if (!hasCodeExt && !rootish && !elided) return null;
  // A bare identifier with no `/` and no extension is not a citation. Neither is
  // `and/or` — its first segment is not a directory in this repo.
  if (!file.includes('/') && !hasCodeExt) return null;

  return { file, lines, isDir: !hasCodeExt };
}

/** basename → tracked paths, and the set of top-level segments. */
function buildTreeIndex() {
  let listed = [];
  try {
    listed = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean);
  } catch {
    listed = [];
  }
  const byBase = new Map();
  const roots = new Set();
  for (const p of listed) {
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(p);
    roots.add(p.split('/')[0]);
  }
  return { tracked: new Set(listed), byBase, roots, count: listed.length };
}

/**
 * Resolve a cited path to a tracked file.
 *
 * Three cases, in order of confidence:
 *   1. tracked verbatim                        → resolved, resolvedFrom: null
 *   2. elided (`.../competitions/Foo.tsx`)     → unique suffix match
 *   3. bare basename (`useStudioComposer.ts`)  → unique basename match
 * Ambiguity is NOT resolved by picking one. An ambiguous citation stays
 * unresolved and keeps its verbatim text, because a router entry pointing at the
 * wrong file is worse than a missing one — it fires a hook on a path the corpus
 * never discussed.
 */
function resolveCitation(file, tree) {
  if (tree.tracked.has(file)) return { resolved: file, resolvedFrom: null };

  if (file.includes('...')) {
    const suffix = file.split('...').pop().replace(/^\/+/, '');
    if (suffix) {
      const base = suffix.slice(suffix.lastIndexOf('/') + 1);
      const candidates = (tree.byBase.get(base) ?? []).filter((p) => p.endsWith(suffix));
      if (candidates.length === 1) return { resolved: candidates[0], resolvedFrom: 'elided-suffix' };
    }
    return { resolved: null, resolvedFrom: null };
  }

  if (!file.includes('/')) {
    const candidates = tree.byBase.get(file) ?? [];
    if (candidates.length === 1) return { resolved: candidates[0], resolvedFrom: 'basename' };
    return { resolved: null, resolvedFrom: null };
  }

  // A path fragment written without its root (`engine/platforms/deploy.rs`).
  const base = file.slice(file.lastIndexOf('/') + 1);
  const candidates = (tree.byBase.get(base) ?? []).filter((p) => p.endsWith('/' + file) || p === file);
  if (candidates.length === 1) return { resolved: candidates[0], resolvedFrom: 'suffix' };
  return { resolved: null, resolvedFrom: null };
}

/**
 * Group a document's raw citations by file.
 *
 * DEVIATION FROM THE BRIEF, recorded here rather than silently: the brief asked
 * for a flat list of `{file, lines, section, context}`. That shape was built,
 * measured, and produces a **9.0 MB** index.json — 26,004 citations, of which
 * only 12,357 are distinct (document, file) pairs, so 52% of the bytes are the
 * same file cited again with another line of prose beside it.
 *
 * Grouping by file keeps every fact a consumer reads — which files, which
 * sections, which line ranges, and ONE representative line of prose — and drops
 * the 2nd-and-later prose line for a given file within a given document.
 * `count` preserves the true number, so nothing silently under-reports, and the
 * document itself is one click away and is the actual source. Grouped with one
 * context the artifact is ~3 MB; with the flat shape it was 9 MB, and the whole
 * difference is prose the reader would go to the document for anyway.
 *
 * Measured trade-off, so a future maintainer can reverse it knowingly:
 *   flat, 26,004 entries, 2 contexts .... 9.0 MB
 *   grouped, 12,357 entries, 2 contexts .. 5.2 MB
 *   grouped, 12,357 entries, 1 context ... this
 */
const CONTEXTS_PER_FILE = 1;
function groupCitations(raw) {
  const byFile = new Map();
  for (const c of raw) {
    const key = c.file;
    if (!byFile.has(key)) {
      byFile.set(key, {
        count: 0,
        sections: new Set(),
        lines: [],
        contexts: [],
        ...(c.resolved === false ? { resolved: false } : {}),
        ...(c.isDir ? { isDir: true } : {}),
        ...(c.resolvedFrom ? { resolvedFrom: c.resolvedFrom, verbatim: c.verbatim } : {}),
      });
    }
    const e = byFile.get(key);
    e.count++;
    if (c.section !== null && c.section !== undefined) e.sections.add(c.section);
    if (c.lines && !e.lines.includes(c.lines) && e.lines.length < 8) e.lines.push(c.lines);
    if (c.context && !e.contexts.includes(c.context) && e.contexts.length < CONTEXTS_PER_FILE) e.contexts.push(c.context);
  }
  const out = {};
  for (const key of [...byFile.keys()].sort()) {
    const e = byFile.get(key);
    out[key] = {
      count: e.count,
      sections: [...e.sections].sort((a, b) => a - b),
      ...(e.lines.length ? { lines: e.lines } : {}),
      contexts: e.contexts,
      ...(e.resolved === false ? { resolved: false } : {}),
      ...(e.isDir ? { isDir: true } : {}),
      ...(e.resolvedFrom ? { resolvedFrom: e.resolvedFrom, verbatim: e.verbatim } : {}),
    };
  }
  return out;
}

/** Every inline-code citation in a document, with its section and context line. */
function extractCitations(md, sectionsOrdered, tree) {
  const scrubbed = blankFences(md);
  const lines = scrubbed.split('\n');
  const out = [];
  const sectionAt = (lineNo) => {
    let cur = null;
    for (const s of sectionsOrdered) {
      if (s.startLine <= lineNo) cur = s; else break;
    }
    return cur ? cur.num : null;
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const spans = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    if (spans.length === 0) return;
    const context = cap(line.replace(/^[ \t]*>[ \t]?/, '').trim(), 200);
    const section = sectionAt(lineNo);
    for (const span of spans) {
      const c = classifyCitation(span, tree.roots);
      if (!c) continue;
      const r = resolveCitation(c.file, tree);
      out.push({
        file: r.resolved ?? c.file,
        ...(r.resolved ? {} : { resolved: false }),
        ...(r.resolvedFrom ? { resolvedFrom: r.resolvedFrom, verbatim: c.file } : {}),
        ...(c.lines ? { lines: c.lines } : {}),
        ...(c.isDir ? { isDir: true } : {}),
        section,
        context,
      });
    }
  });
  return out;
}

// ─────────────────────────────────────────────────────── build

function buildArtifacts() {
  if (!fs.existsSync(PATHS_DIR)) {
    fatal(`required input missing: ${PATHS_DIR}`);
  }
  const tree = buildTreeIndex();
  if (tree.count === 0) {
    fatal('`git ls-files` returned nothing. THE TREE INDEX IS BROKEN — every citation would resolve to false and the router would be empty.');
  }

  const files = fs.readdirSync(PATHS_DIR)
    .filter((f) => f.endsWith('.md') && !NOT_A_PATH.has(f))
    .sort();
  if (files.length === 0) fatal('zero golden-path .md files. THE READER IS BROKEN.');

  const docs = {};
  const zeroCitationDocs = [];
  const parseFailures = [];
  let totalCitations = 0;
  let resolvedCitations = 0;
  let fileCitations = 0;

  for (const f of files) {
    const leaf = f.replace(/\.md$/, '');
    const md = normalizeEol(fs.readFileSync(path.join(PATHS_DIR, f), 'utf8'));
    const { sections, ordered } = parseSections(md);

    const s0 = sections.get(0);
    const headline = cap(s0 ? firstParagraph(s0.body) : firstParagraphAfterTitle(md), 400);
    const s2 = sections.get(2);
    const oneWay = s2 ? cap(firstParagraph(s2.body), 300) : '';
    const s7 = sections.get(7);
    const deviations = s7 ? extractDeviations(s7.body) : [];
    const s1 = sections.get(1);
    const triggers = s1 ? extractTriggers(s1.body) : [];

    // Rule ids: §9 first (where the contract puts them), whole document as a
    // fallback for the paths that publish the fence outside a numbered §9.
    // Which source was used is recorded — a silent fallback is how you stop
    // noticing that §9 stopped parsing.
    const s9 = sections.get(9);
    let ruleIds = [];
    let ruleIdsFrom = 'none';
    if (s9) {
      const p = extractPublishedRules(s9.body);
      if (p.rules.length) { ruleIds = p.rules.map((r) => r.id); ruleIdsFrom = 'section-9'; }
    }
    if (ruleIds.length === 0) {
      const p = extractPublishedRules(md);
      if (p.rules.length) { ruleIds = p.rules.map((r) => r.id); ruleIdsFrom = 'document'; }
    }

    const citations = extractCitations(md, ordered, tree);
    totalCitations += citations.length;
    resolvedCitations += citations.filter((c) => c.resolved !== false).length;
    fileCitations += citations.filter((c) => !c.isDir).length;

    if (citations.length === 0) {
      zeroCitationDocs.push(leaf);
      // A document with no citations AND no triggers has told the parser
      // nothing at all. That is indistinguishable from a parse failure, so it
      // is treated as one — the whole point of asserting the instrument.
      if (triggers.length === 0) parseFailures.push(leaf);
    }

    docs[leaf] = {
      leaf,
      doc: `docs/concepts/golden-paths/${f}`,
      headline,
      oneWay,
      deviations,
      ruleIds: [...ruleIds].sort(),
      ruleIdsFrom,
      sections: ordered.filter((o) => o.num !== null).map((o) => o.num).sort((a, b) => a - b),
      citationCount: citations.length,
      citations: groupCitations(citations),
      triggers,
    };
  }

  // ── router (file-major)
  const byFile = {};
  const byDir = {};
  const triggers = {};
  for (const leaf of Object.keys(docs).sort()) {
    const d = docs[leaf];
    if (d.triggers.length) triggers[leaf] = d.triggers;
    for (const [file, e] of Object.entries(d.citations)) {
      // Only files the corpus actually names AND that exist in this checkout
      // reach the router. A directory reference (`src/`) and an ambiguous
      // basename (`lib.rs`, 220 citations) are both real prose but neither
      // identifies a file, and a hook that fired on a guess would be worse than
      // one that stayed quiet.
      if (e.resolved === false || e.isDir) continue;
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push({ leaf, sections: e.sections, count: e.count });
      const dir = dirPrefix(file, 2);
      if (dir) {
        if (!byDir[dir]) byDir[dir] = {};
        byDir[dir][leaf] = (byDir[dir][leaf] ?? 0) + e.count;
      }
    }
  }
  for (const file of Object.keys(byFile)) {
    byFile[file].sort((a, b) => b.count - a.count || a.leaf.localeCompare(b.leaf));
  }
  const byDirOut = {};
  for (const dir of Object.keys(byDir).sort()) {
    byDirOut[dir] = Object.entries(byDir[dir])
      .map(([leaf, count]) => ({ leaf, count }))
      .sort((a, b) => b.count - a.count || a.leaf.localeCompare(b.leaf));
  }

  const distinctFiles = Object.keys(byFile).length;
  const resolvedCount = resolvedCitations;

  // ── the floors, checked before anything is written
  if (files.length < FLOOR_DOCS) {
    fatal(`parsed ${files.length} docs but the floor is ${FLOOR_DOCS}. THE READER IS BROKEN, NOT THE CORPUS SHRUNK.`);
  }
  if (totalCitations < FLOOR_CITATIONS) {
    fatal(`extracted ${totalCitations} citations but the floor is ${FLOOR_CITATIONS}. THE CITATION MATCHER IS BROKEN — a silently-empty router looks exactly like a corpus that cites nothing.`);
  }
  if (distinctFiles < FLOOR_DISTINCT_FILES) {
    fatal(`router covers ${distinctFiles} distinct files but the floor is ${FLOOR_DISTINCT_FILES}. THE RESOLVER IS BROKEN.`);
  }
  if (zeroCitationDocs.length > CEILING_ZERO_CITATION_DOCS) {
    fatal(`${zeroCitationDocs.length} docs yielded zero citations (ceiling ${CEILING_ZERO_CITATION_DOCS}): ${zeroCitationDocs.slice(0, 12).join(', ')}`);
  }
  if (parseFailures.length) {
    fatal(`${parseFailures.length} doc(s) yielded NO citations AND NO trigger lines: ${parseFailures.join(', ')}\n` +
      '       A parse failure must not be indistinguishable from a quiet document.');
  }

  // ── cross-artifact inventory, BOTH directions (doctrine §2: a diff-shaped
  //    gate cannot see an absence; only an inventory of what SHOULD exist finds
  //    the missing thing). This is the check that catches a fence extractor
  //    that has quietly stopped extracting.
  const crossProblems = [];
  const knownUnextractable = new Set(Object.keys(RULES_WITHOUT_EXTRACTABLE_FENCE));
  const stillUnextractable = new Set();
  if (fs.existsSync(RULES)) {
    const registry = JSON.parse(fs.readFileSync(RULES, 'utf8'));
    for (const r of registry.rules ?? []) {
      if (!r.goldenPath) continue;
      const base = r.goldenPath.split('/').pop();
      if (!base || !base.endsWith('.md')) continue;
      const leaf = base.replace(/\.md$/, '');
      const d = docs[leaf];
      if (!d) { crossProblems.push(`rule "${r.id}" cites goldenPath "${r.goldenPath}", which has no index entry`); continue; }
      if (!d.ruleIds.includes(r.id)) {
        if (knownUnextractable.has(r.id)) { stillUnextractable.add(r.id); continue; }
        crossProblems.push(
          `rule "${r.id}" is registered against ${leaf} but was NOT extracted from that document's fences ` +
          `(the fence extractor found ${d.ruleIds.length}: ${d.ruleIds.join(', ') || 'none'}). ` +
          `A rule that cannot be re-derived from its own document is indistinguishable from a rule the extractor LOST.`);
      }
    }
    // The other direction: an entry that has started extracting is a stale
    // exemption and must be removed, or the list stops meaning anything.
    for (const id of knownUnextractable) {
      if (!stillUnextractable.has(id)) {
        crossProblems.push(
          `RULES_WITHOUT_EXTRACTABLE_FENCE lists "${id}", but it now extracts cleanly (or has left rules.json). ` +
          `Remove the entry — a stale exemption is where violations hide.`);
      }
    }
  }
  if (crossProblems.length) {
    fatal(`cross-artifact inventory failed — ${crossProblems.length} problem(s):\n` +
      crossProblems.map((p) => `       - ${p}`).join('\n'));
  }

  const index = {
    $comment: 'GENERATED by scripts/census/build-golden-path-index.mjs — do not edit by hand. Deterministic: no timestamps, no commit hashes, sorted keys.',
    schema: 1,
    totals: {
      docs: files.length,
      citations: totalCitations,
      fileCitations,
      citationsResolved: resolvedCount,
      distinctFiles,
      docsWithZeroCitations: zeroCitationDocs.length,
      ruleIds: Object.values(docs).reduce((n, d) => n + d.ruleIds.length, 0),
      rulesWithoutExtractableFence: Object.keys(RULES_WITHOUT_EXTRACTABLE_FENCE).length,
    },
    docs,
  };
  // `leaves` is the hook's whole payload budget. scripts/docs/check-golden-path-touch.mjs
  // runs on EVERY turn, so it must decide from one small file; index.json is
  // 4.4 MB and is opened only when the hook has already decided to fire.
  const leaves = {};
  for (const leaf of Object.keys(docs).sort()) {
    leaves[leaf] = { doc: docs[leaf].doc, oneWay: docs[leaf].oneWay || docs[leaf].headline };
  }

  const router = {
    $comment: 'GENERATED by scripts/census/build-golden-path-index.mjs — do not edit by hand.',
    schema: 1,
    totals: { files: distinctFiles, dirs: Object.keys(byDirOut).length, leaves: Object.keys(leaves).length },
    leaves,
    byFile: sortKeys(byFile),
    byDir: byDirOut,
    triggers: sortKeys(triggers),
  };

  return { index, router, stats: { docs: files.length, totalCitations, fileCitations, distinctFiles, resolvedCount, zeroCitationDocs } };
}

function firstParagraphAfterTitle(md) {
  const body = md.replace(/^#[ \t][^\n]*\n/, '');
  return firstParagraph(body);
}

function dirPrefix(file, depth) {
  const parts = file.split('/');
  if (parts.length <= 1) return null;
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

function sortKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

/**
 * Deterministic pretty-print with COMPACT LEAVES: any object or array whose
 * one-line JSON fits in `COMPACT_WIDTH` is emitted on one line.
 *
 * This is a size decision, not a style one. Fully-expanded, the two artifacts
 * are 9.0 MB and 1.5 MB, almost entirely indentation on three-key citation
 * objects. Compact leaves keep the structure readable at the level anyone
 * actually reads it (leaf → file) while cutting the byte count by roughly 3×.
 *
 * Key order is insertion order, and every map that goes in here is built with
 * sorted keys, so the output is stable across runs and machines — which is the
 * whole basis for `--check` being a byte comparison.
 */
const COMPACT_WIDTH = 200;

function serialize(obj) {
  return render(obj, 0) + '\n';
}

function render(value, depth) {
  const pad = '  '.repeat(depth);
  const padIn = '  '.repeat(depth + 1);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  const oneLine = JSON.stringify(value);
  if (oneLine.length + pad.length <= COMPACT_WIDTH) return oneLine;

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((v) => padIn + render(v, depth + 1));
    return '[\n' + parts.join(',\n') + '\n' + pad + ']';
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const parts = keys.map((k) => padIn + JSON.stringify(k) + ': ' + render(value[k], depth + 1));
  return '{\n' + parts.join(',\n') + '\n' + pad + '}';
}

function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  console.error('Refusing to write an artifact from an instrument that cannot be trusted.');
  process.exit(2);
}

// ─────────────────────────────────────────────────────── modes

const args = process.argv.slice(2);
const mode =
  args[0] === '--check' ? 'check'
  : args[0] === '--prime' ? 'prime'
  : args[0] === '--prime-diff' ? 'prime-diff'
  : args[0] === undefined || args[0] === '--write' ? 'write'
  : 'usage';

if (mode === 'usage') {
  console.error('usage: build-golden-path-index.mjs [--check | --prime <file...> | --prime-diff]');
  process.exit(2);
}

if (mode === 'write' || mode === 'check') {
  const { index, router, stats } = buildArtifacts();
  const indexText = serialize(index);
  const routerText = serialize(router);

  if (mode === 'check') {
    const problems = [];
    for (const [file, text] of [[INDEX_OUT, indexText], [ROUTER_OUT, routerText]]) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (!fs.existsSync(file)) { problems.push(`${rel} is MISSING`); continue; }
      const onDisk = fs.readFileSync(file, 'utf8');
      if (onDisk !== text) problems.push(`${rel} is STALE (${onDisk.length} bytes on disk, ${text.length} bytes regenerated)`);
    }
    if (problems.length) {
      console.error('golden-path index drift:');
      for (const p of problems) console.error(`  - ${p}`);
      console.error('\nfix: node scripts/census/build-golden-path-index.mjs');
      process.exit(1);
    }
    console.log(`golden-path index fresh · ${stats.docs} docs · ${stats.totalCitations} citations · ${stats.distinctFiles} files`);
    process.exit(0);
  }

  fs.writeFileSync(INDEX_OUT, indexText);
  fs.writeFileSync(ROUTER_OUT, routerText);
  console.log(
    `golden-path index: ${stats.docs} docs · ${stats.totalCitations} citations ` +
    `(${stats.resolvedCount} resolved, ${Math.round((stats.resolvedCount / stats.totalCitations) * 100)}%) · ` +
    `${stats.distinctFiles} distinct files · ${stats.zeroCitationDocs.length} docs with no citations`,
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────── --prime
// The brief-priming door: given files, print every claim the corpus makes about
// them, grouped by leaf, as markdown on stdout. This is what a composer or a
// session pastes into its own context before touching a governed file.
{
  let targets = [];
  if (mode === 'prime-diff') {
    try {
      targets = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      console.error('could not read `git diff --name-only HEAD`');
      process.exit(2);
    }
  } else {
    targets = args.slice(1).map((a) => path.isAbsolute(a)
      ? path.relative(ROOT, a).split(path.sep).join('/')
      : a.split(path.sep).join('/'));
  }
  if (targets.length === 0) {
    console.error('no files to prime on.');
    process.exit(2);
  }

  let router;
  try {
    router = JSON.parse(fs.readFileSync(ROUTER_OUT, 'utf8'));
  } catch {
    console.error(`router.json unreadable — run: node scripts/census/build-golden-path-index.mjs`);
    process.exit(2);
  }
  const index = JSON.parse(fs.readFileSync(INDEX_OUT, 'utf8'));

  const byLeaf = new Map();
  for (const t of targets) {
    const entries = router.byFile[t];
    if (!entries) continue;
    for (const e of entries) {
      if (!byLeaf.has(e.leaf)) byLeaf.set(e.leaf, { count: 0, files: new Set() });
      const b = byLeaf.get(e.leaf);
      b.count += e.count;
      b.files.add(t);
    }
  }

  if (byLeaf.size === 0) {
    console.log(`No golden path in the corpus cites any of: ${targets.join(', ')}`);
    process.exit(0);
  }

  const ranked = [...byLeaf.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  console.log(`# Golden-path priming — ${targets.length} file(s), ${ranked.length} governing path(s)\n`);
  for (const [leaf, meta] of ranked) {
    const d = index.docs[leaf];
    if (!d) continue;
    console.log(`## ${leaf} — ${meta.count} citation(s) across ${meta.files.size} of your file(s)`);
    console.log(`_${d.doc}_\n`);
    if (d.oneWay) console.log(`**§2 the one way.** ${d.oneWay}\n`);
    else if (d.headline) console.log(`**§0.** ${d.headline}\n`);
    for (const t of [...meta.files].sort()) {
      const e = d.citations[t];
      if (!e) continue;
      const secs = e.sections.length ? e.sections.map((n) => `§${n}`).join(' ') : '—';
      const lines = e.lines?.length ? ` \`:${e.lines.join(' :')}\`` : '';
      console.log(`- \`${t}\` — ${e.count} citation(s), ${secs}${lines}`);
      for (const ctx of e.contexts.slice(0, 3)) console.log(`  - ${ctx}`);
    }
    if (d.deviations.length) {
      console.log(`\n**§7 deviations already on record:**`);
      for (const dv of d.deviations.slice(0, 6)) console.log(`  - ${dv}`);
    }
    console.log('');
  }
  process.exit(0);
}
