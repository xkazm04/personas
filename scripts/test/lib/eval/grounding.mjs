// Grounding gate (docs/test/evaluation-rubric.md §1) — the anti-eloquence
// guard: do an artifact's cited file paths actually exist in the repo?
//
// Extracted verbatim from evaluate.mjs. The CITE_RE alternation order and the
// suffix-match fallback are LOAD-BEARING and preserved exactly — see
// tests/cli/grounding.test.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Extract file-path citations from markdown/text. Matches `path/to/file.ext`
// (optionally `:line`), restricted to source-like extensions so prose nouns
// aren't mistaken for paths.
// Extensions ordered so disambiguating ones win the alternation (json before
// js, tsx before ts, mjs before js) — else ".json" matches as ".js" and a real
// path reads as ungrounded.
export const CITE_RE = /`?(\.{0,2}\/?[A-Za-z0-9_./-]+\.(?:tsx|ts|jsx|mjs|json|js|rs|py|go|java|css|sql|toml|yaml|yml|md|adr))(?::\d+(?:-\d+)?)?`?/g;

// Index of every real file in the repo (tracked + untracked-not-ignored), as
// forward-slash repo-relative paths. New team artifacts are untracked, so we
// include `--others --exclude-standard`. Used for suffix-match grounding.
export function repoFileIndex(repoRoot) {
  if (!repoRoot) return [];
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  } catch {
    return [];
  }
}

export function groundingForText(text, repoRoot, fileDir, repoFiles = []) {
  const cites = new Map(); // path -> exists
  // Fresh regex state per call: CITE_RE is a module-level /g regex, so reset
  // lastIndex to keep groundingForText pure across repeated calls.
  CITE_RE.lastIndex = 0;
  let m;
  while ((m = CITE_RE.exec(text)) !== null) {
    const p = m[1];
    if (p.startsWith('http')) continue;
    const isPathy = p.includes('/') || p.startsWith('./') || p.startsWith('../');
    // Primary resolution: relative links (./x, ../x) against the citing file's
    // dir; repo-relative paths against repo root.
    let ok = false;
    if (p.startsWith('./') || p.startsWith('../')) ok = existsSync(join(fileDir || repoRoot, p));
    else if (p.includes('/')) ok = existsSync(join(repoRoot, p));
    else ok = existsSync(join(repoRoot, p)); // bare filename at repo root (CHANGELOG.md, package.json)
    // Suffix-match fallback: ADRs legitimately cite shorthand relative to their
    // stated Area (`components/FunnelCard.tsx` for src/features/placements/...)
    // or a sibling (`./conversion.ts`). These don't resolve against repo-root or
    // the doc's own dir, but DO correspond to a real repo file. Match the cited
    // tail as a path-suffix of an actual file; a hallucinated path matches none.
    if (!ok) {
      const tail = p.replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '');
      if (tail) ok = repoFiles.some((rf) => rf === tail || rf.endsWith('/' + tail));
    }
    // A bare token (no '/', no ./) that resolves to nothing is treated as prose,
    // NOT a citation — this drops brand nouns that the extension regex catches
    // (Next.js, Node.js, Vue.js) from the denominator instead of scoring them
    // as ungrounded. Slashed/relative tokens are unambiguously path citations,
    // so a non-resolving one IS a real hallucination and counts invalid.
    if (!ok && !isPathy) continue;
    if (!cites.has(p) || ok) cites.set(p, ok);
  }
  const total = cites.size;
  const valid = [...cites.values()].filter(Boolean).length;
  const invalid = [...cites.entries()].filter(([, ok]) => !ok).map(([p]) => p);
  return { total, valid, pct: total ? Math.round((valid / total) * 100) : null, invalid: invalid.slice(0, 8) };
}

// Pull added markdown files (doc-track artifacts) from the run's repo.patch.
export function addedDocsFromPatch(patchPath) {
  if (!existsSync(patchPath)) return [];
  const patch = readFileSync(patchPath, 'utf8');
  const files = [];
  const re = /^diff --git a\/(\S+) b\/(\S+)/gm;
  let m;
  while ((m = re.exec(patch)) !== null) {
    const f = m[2];
    // Exclude .claude/ tooling artifacts (goal-analysis/idea cards, CLAUDE.md) —
    // these are agent scaffolding, not team deliverables, and shouldn't count
    // toward the team's grounding score.
    if (f.startsWith('.claude/')) continue;
    if (/\.(md|adr)$/i.test(f) || f.includes('/adr/')) files.push(f);
  }
  return [...new Set(files)];
}
