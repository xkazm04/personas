import { describe, expect, it } from 'vitest';
import { parseRefHref, parseRefLinks, REF_KINDS, rewriteRefHrefs } from '../refGrammar';

describe('parseRefLinks', () => {
  it('finds a link of every contract kind', () => {
    for (const kind of REF_KINDS) {
      const refs = parseRefLinks(`See [the thing](ref:${kind}/abc123) now.`);
      expect(refs).toEqual([{ phrase: 'the thing', kind, handle: 'abc123' }]);
    }
  });

  it('drops an unknown kind, an empty handle and an empty phrase', () => {
    expect(parseRefLinks('[x](ref:widget/abc)')).toEqual([]);
    expect(parseRefLinks('[x](ref:report/)')).toEqual([]);
    expect(parseRefLinks('[ ](ref:report/r1)')).toEqual([]);
  });

  it('ignores links inside inline code and fenced blocks', () => {
    expect(parseRefLinks('Use `[x](ref:report/r1)` literally.')).toEqual([]);
    expect(parseRefLinks('```\n[x](ref:report/r1)\n```')).toEqual([]);
  });

  it('keeps reading order across two links', () => {
    const refs = parseRefLinks('[a](ref:session/s1) then [b](ref:memory/fact_1)');
    expect(refs.map((r) => r.kind)).toEqual(['session', 'memory']);
  });
});

describe('rewriteRefHrefs', () => {
  it('moves a valid link into the fragment and leaves normal links alone', () => {
    expect(rewriteRefHrefs('[the plan](ref:card/c1) and [docs](https://x.dev)')).toBe(
      '[the plan](#ref:card/c1) and [docs](https://x.dev)',
    );
  });

  it('collapses an unknown kind to its phrase', () => {
    expect(rewriteRefHrefs('Open [this](ref:widget/w1).')).toBe('Open this.');
  });

  it('never rewrites inside code', () => {
    const text = 'Try `[x](ref:card/c1)`.\n```\n[y](ref:card/c2)\n```';
    expect(rewriteRefHrefs(text)).toBe(text);
  });
});

describe('parseRefHref', () => {
  it('decodes a rewritten href and rejects everything else', () => {
    expect(parseRefHref('#ref:report/r_1')).toEqual({ kind: 'report', handle: 'r_1' });
    expect(parseRefHref('#ref:nope/r_1')).toBeNull();
    expect(parseRefHref('https://example.com')).toBeNull();
    expect(parseRefHref(undefined)).toBeNull();
  });
});
