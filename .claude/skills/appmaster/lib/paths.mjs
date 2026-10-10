// Declared builder paths and whether two builders' paths can collide. Two builders of one project
// run side by side only when what they declared they will touch is disjoint. This check is
// CONSERVATIVE by design: whenever it cannot prove two specs disjoint, they overlap.
//
// A spec is a repo-relative path prefix or glob: `src/app/org/`, `src/lib/a.ts`, `docs/**/*.md`.
// Its SCOPE is the literal directory part before the first glob character, as path segments:
//   src/app/org/      -> [src, app, org]       that directory and everything under it
//   src/lib/a.ts      -> [src, lib, a.ts]      that file (or a directory of that name) and below
//   src/app*          -> [src]                 `*` could match any name in src/, so all of src/
//   docs/**/*.md      -> [docs]                anything under docs/ (the extension is not trusted)
//   *.md, **          -> []                    the whole repo
// Two specs overlap iff one scope is a segment-prefix of the other. Case-insensitive always: the
// checkouts live on Windows. An empty list of specs means the whole repo.

const GLOB = /[*?[\]{}]/;

/** 'C:\\x' -> null etc.: the reason a spec is unusable, or null when it is a valid repo-relative spec. */
export function specError(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return 'must be a non-empty string';
  const s = spec.trim();
  if (/\s/.test(s)) return 'must be a path or glob without whitespace';
  if (/^[A-Za-z]:/.test(s) || s.startsWith('/') || s.startsWith('\\')) return 'must be repo-relative, not absolute';
  if (s.replace(/\\/g, '/').split('/').includes('..')) return 'must not climb out of the repo (..)';
  if (s.includes('!')) return 'must not be a negated glob';
  return null;
}

/** The literal scope of one spec, as lower-cased path segments ([] = the whole repo). */
export function scopeOf(spec) {
  const s = String(spec).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
  const segs = s.split('/').filter((x) => x && x !== '.');
  const out = [];
  for (const seg of segs) {
    if (GLOB.test(seg)) break;   // this segment and everything after it can match anything
    out.push(seg.toLowerCase());
  }
  return out;
}

const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);

/** Can two specs name a common file? (conservative: true unless provably disjoint) */
export function specsOverlap(a, b) {
  const sa = scopeOf(a), sb = scopeOf(b);
  return isPrefix(sa, sb) || isPrefix(sb, sa);
}

/**
 * (listA, listB) => [[a, b], ...]   every overlapping pair; an empty or absent list is the whole repo,
 * so it overlaps anything (reported as ['*', b] / [a, '*']).
 */
export function overlappingPairs(listA, listB) {
  const A = Array.isArray(listA) && listA.length ? listA : ['*'];
  const B = Array.isArray(listB) && listB.length ? listB : ['*'];
  const pairs = [];
  for (const a of A) for (const b of B) if (specsOverlap(a, b)) pairs.push([a, b]);
  return pairs;
}

/** Do two declared path lists overlap at all? */
export const pathsOverlap = (listA, listB) => overlappingPairs(listA, listB).length > 0;
