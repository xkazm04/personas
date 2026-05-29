import { describe, it, expect } from 'vitest';
import { CITE_RE, groundingForText } from '../../scripts/test/lib/eval/grounding.mjs';

function matches(s) {
  CITE_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = CITE_RE.exec(s)) !== null) out.push(m[1]);
  return out;
}

describe('CITE_RE alternation order (disambiguating extensions win)', () => {
  it('matches .json in full, not as .js', () => {
    expect(matches('see `package.json`')).toContain('package.json');
  });
  it('matches .tsx in full, not as .ts', () => {
    expect(matches('`src/App.tsx`')).toContain('src/App.tsx');
  });
  it('matches .mjs in full, not as .js', () => {
    expect(matches('`scripts/test/run.mjs`')).toContain('scripts/test/run.mjs');
  });
});

describe('groundingForText resolution', () => {
  // A repo root that does not exist forces the primary existsSync() checks to
  // fail, isolating the suffix-match + prose-drop branches under test.
  const NO_REPO = '/__no_such_repo__';

  it('suffix-match validates shorthand ADR citations against the repo file index', () => {
    const repoFiles = ['src/features/placements/components/FunnelCard.tsx'];
    const g = groundingForText('Edit `components/FunnelCard.tsx`.', NO_REPO, NO_REPO, repoFiles);
    expect(g.total).toBe(1);
    expect(g.valid).toBe(1);
    expect(g.pct).toBe(100);
    expect(g.invalid).toEqual([]);
  });

  it('slashed path with no match counts as an invalid (real hallucination)', () => {
    const g = groundingForText('See `components/Ghost.tsx`.', NO_REPO, NO_REPO, []);
    expect(g.total).toBe(1);
    expect(g.valid).toBe(0);
    expect(g.invalid).toContain('components/Ghost.tsx');
  });

  it('bare unresolved prose nouns (Next.js / Node.js) drop out of the denominator', () => {
    const g = groundingForText('We use Next.js and Node.js heavily.', NO_REPO, NO_REPO, []);
    expect(g.total).toBe(0);
    expect(g.pct).toBeNull();
  });

  it('pct is null when there are no citations', () => {
    const g = groundingForText('Prose with no paths at all.', NO_REPO, NO_REPO, []);
    expect(g).toEqual({ total: 0, valid: 0, pct: null, invalid: [] });
  });

  it('is pure across repeated calls (regex lastIndex reset)', () => {
    const repoFiles = ['a/b/Foo.tsx'];
    const a = groundingForText('`b/Foo.tsx`', NO_REPO, NO_REPO, repoFiles);
    const b = groundingForText('`b/Foo.tsx`', NO_REPO, NO_REPO, repoFiles);
    expect(a).toEqual(b);
    expect(a.valid).toBe(1);
  });
});
