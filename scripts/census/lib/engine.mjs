/**
 * Census engine — the shared walk + match + assert core.
 *
 * Deliberately separated from `run-census.mjs` so that `self-test.mjs` exercises
 * THE SAME code the real run uses. A self-test that re-implements matching would
 * prove nothing about the runner.
 *
 * Design note (the reason this file exists at all):
 * `docs/concepts/wave-1-reflection.md` §"What would make wave 2 better" item 2 —
 * 247 situation leaves x ~2 gates is ~460 bespoke scripts. Three golden paths
 * (tables.md, inline-busy-state.md §9, dropdown-and-select.md §9) each specified
 * a near-identical "ratcheting baseline count" mechanism independently. This is
 * that mechanism, once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Directories never worth walking, in any repo. */
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'coverage']);

/**
 * Convert a rule-file path pattern into a RegExp.
 * Supported: exact paths, `dir/` prefixes, and globs using `**` / `*`.
 * Paths are always compared in posix form relative to the repo root.
 */
export function patternToRegExp(pattern) {
  if (pattern.endsWith('/')) {
    return new RegExp('^' + escapeRe(pattern));
  }
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:[^/]*/)*';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      out += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      out += '[^/]*';
      i += 1;
    } else {
      out += escapeRe(pattern[i]);
      i += 1;
    }
  }
  return new RegExp('^' + out + '$');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Walk `dir`, collecting files whose name ends with one of `extensions`. */
export function walkFiles(dir, extensions, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // caller's floor assertion turns a missing root into a loud failure
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, extensions, out);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A line that is *only* a comment. Intentionally conservative: it looks at the
 * start of the trimmed line and nothing else, so it can never swallow code that
 * happens to contain `//` inside a string (a URL, a regex).
 *
 * This matters more than it looks. The `raw-web-storage` signal as originally
 * specified ("430 lines, precision near-perfect") is 35% prose: 153 of its 439
 * raw matches are JSDoc and `//` comments *about* the migration away from
 * localStorage. A gate keyed on the raw number would baseline mostly commentary.
 */
export function isCommentOnlyLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Precompute line-start offsets so a match index maps to a 1-based line number.
 *
 * Separator lengths are measured, never assumed. The obvious implementation —
 * `source.split(/\r?\n/)` then `offset += line.length + 1` — is off by one per
 * line on CRLF files, which is most of this repo's tree on Windows. That drift
 * makes `lineOf()` return a neighbouring line, so the comment filter reads the
 * WRONG line's text and silently miscounts. It was caught here by a second
 * independent implementation disagreeing by exactly 1 match in
 * `src/hooks/utility/data/usePersistedContext.ts` (76 CRLF line endings).
 * `__fixtures__/crlf-file.tsx` is the regression guard.
 */
function lineIndexer(source) {
  const lines = [];
  const starts = [];
  const sep = /\r?\n/g;
  let pos = 0;
  let m;
  while ((m = sep.exec(source)) !== null) {
    starts.push(pos);
    lines.push(source.slice(pos, m.index));
    pos = m.index + m[0].length;
  }
  starts.push(pos);
  lines.push(source.slice(pos));

  return {
    lines,
    lineOf(index) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= index) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

/**
 * Build the matcher for a rule.
 *
 * NOTE, and this is the single most important line in the file: matching runs
 * against WHOLE FILE CONTENT, never line by line. A line-by-line matcher with a
 * pattern like `<select[\s/>]` silently misses every `<select` that ends its
 * line — which in this repo is 63 of 67 raw selects. That exact bug produced a
 * "4 violations, looks clean!" reading during this runner's own construction.
 */
function buildRegExp(signal) {
  const flags = signal.flags ?? '';
  return new RegExp(signal.pattern, flags.includes('g') ? flags : flags + 'g');
}

/**
 * Scan one rule. Returns a result object; performs NO assertions and never
 * exits — the caller decides what is fatal (so the self-test can inspect
 * failures instead of dying on them).
 */
export function scanRule(rule, { root }) {
  const excludes = (rule.exclude ?? []).map((entry) => ({
    ...entry,
    regexp: patternToRegExp(entry.path),
    hits: 0,
  }));

  const regexp = buildRegExp(rule.signal);
  const ignoreComments = rule.signal.ignoreCommentLines === true;

  let walked = 0;
  let scanned = 0;
  const hits = [];
  let totalMatches = 0;
  let commentMatchesSkipped = 0;

  for (const relRoot of rule.roots) {
    const absRoot = join(root, relRoot);
    for (const abs of walkFiles(absRoot, rule.extensions)) {
      const rel = relative(root, abs).split(sep).join('/');
      walked++;

      const excluded = excludes.find((e) => e.regexp.test(rel));
      if (excluded) {
        excluded.hits++;
        continue;
      }
      scanned++;

      const source = readFileSync(abs, 'utf8');
      // Cheap pre-filter: skip the line indexing for files that cannot match.
      regexp.lastIndex = 0;
      if (!regexp.test(source)) continue;

      const { lines, lineOf } = lineIndexer(source);
      regexp.lastIndex = 0;
      let match;
      let fileMatches = 0;
      const fileLines = new Set();
      while ((match = regexp.exec(source)) !== null) {
        if (match[0].length === 0) {
          regexp.lastIndex++; // zero-width pattern guard
          continue;
        }
        const lineIdx = lineOf(match.index);
        if (ignoreComments && isCommentOnlyLine(lines[lineIdx])) {
          commentMatchesSkipped++;
          continue;
        }
        fileMatches++;
        fileLines.add(lineIdx + 1);
      }
      if (fileMatches > 0) {
        totalMatches += fileMatches;
        hits.push({
          file: rel,
          matches: fileMatches,
          lines: [...fileLines].sort((a, b) => a - b),
        });
      }
    }
  }

  hits.sort((a, b) => (b.matches - a.matches) || a.file.localeCompare(b.file));

  return {
    id: rule.id,
    walked,
    scanned,
    files: hits.length,
    matches: totalMatches,
    commentMatchesSkipped,
    hits,
    excludes: excludes.map(({ path, reason, hits: n }) => ({ path, reason, hits: n })),
  };
}

/**
 * Turn a scan result into a list of problems.
 *
 * The order matters: STRUCTURAL problems (the runner is broken) are reported
 * before DRIFT problems (the codebase moved), because a structural failure makes
 * the drift numbers meaningless. Each problem carries `kind` so the caller can
 * decide severity — structural problems are fatal in every mode, drift is fatal
 * only under `--check`.
 */
export function assertRule(rule, result) {
  const problems = [];

  if (result.walked < rule.floor) {
    problems.push({
      kind: 'structural',
      code: 'floor',
      message:
        `walked ${result.walked} files but floor is ${rule.floor}. ` +
        `THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN — roots ${JSON.stringify(rule.roots)} ` +
        `or extensions ${JSON.stringify(rule.extensions)} no longer describe this repo.`,
    });
  }

  if (result.matches === 0) {
    problems.push({
      kind: 'structural',
      code: 'zero-matches',
      message:
        `matched zero files anywhere. A census rule that finds nothing is a broken ` +
        `regex far more often than a finished migration. If the migration really is ` +
        `complete, DELETE the rule (and its golden-path §9 entry) rather than ` +
        `baselining it at zero — a rule pinned at 0 is a gate that can never fail.`,
    });
  }

  for (const ex of result.excludes) {
    if (ex.hits === 0) {
      problems.push({
        kind: 'structural',
        code: 'stale-exclude',
        message:
          `exclude "${ex.path}" matched no file. The exemption is stale — the file ` +
          `moved or was deleted. Remove the entry or fix the path. ` +
          `(reason on record: ${ex.reason})`,
      });
    }
  }

  const base = rule.baseline;
  for (const metric of ['files', 'matches']) {
    const actual = result[metric];
    const expected = base[metric];
    if (actual > expected) {
      problems.push({
        kind: 'drift',
        code: 'rose',
        message:
          `${metric} rose ${expected} -> ${actual} (+${actual - expected}). New ` +
          `violations of ${rule.goldenPath}. Fix them, or if this is deliberate, ` +
          `say so in the commit message and run \`npm run census -- --update\`.`,
      });
    } else if (actual < expected) {
      problems.push({
        kind: 'drift',
        code: 'dropped',
        message:
          `${metric} dropped ${expected} -> ${actual} (-${expected - actual}) without the ` +
          `baseline moving. A silent drop is a broken matcher more often than fixed ` +
          `code — confirm the fix is real, then run \`npm run census -- --update\` to ` +
          `ratchet the baseline down and lock the win in.`,
      });
    }
  }

  return problems;
}

/** Validate rule shape up front — a malformed registry must not scan silently. */
export function validateRule(rule, index) {
  const where = `rules[${index}]${rule?.id ? ` (${rule.id})` : ''}`;
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(`${where}: ${msg}`); };

  need(typeof rule?.id === 'string' && rule.id.length > 0, 'missing "id"');
  need(typeof rule?.goldenPath === 'string', 'missing "goldenPath" — every rule names the path that owns it');
  need(Array.isArray(rule?.roots) && rule.roots.length > 0, 'missing "roots"');
  need(Array.isArray(rule?.extensions) && rule.extensions.length > 0, 'missing "extensions"');
  need(typeof rule?.signal?.pattern === 'string', 'missing "signal.pattern"');
  need(typeof rule?.signal?.description === 'string', 'missing "signal.description"');
  need(Number.isInteger(rule?.floor) && rule.floor > 0, 'missing "floor" (a positive integer)');
  need(Number.isInteger(rule?.baseline?.files), 'missing "baseline.files"');
  need(Number.isInteger(rule?.baseline?.matches), 'missing "baseline.matches"');

  for (const [i, ex] of (rule?.exclude ?? []).entries()) {
    need(typeof ex?.path === 'string' && ex.path.length > 0, `exclude[${i}] missing "path"`);
    need(
      typeof ex?.reason === 'string' && ex.reason.trim().length >= 12,
      `exclude[${i}] ("${ex?.path}") needs a real "reason" — an unexplained exemption is how ` +
        `an allowlist becomes a place violations go to hide`,
    );
  }

  if (typeof rule?.signal?.pattern === 'string') {
    try {
      buildRegExp(rule.signal);
    } catch (err) {
      errors.push(`${where}: signal.pattern is not a valid RegExp — ${err.message}`);
    }
  }

  return errors;
}
