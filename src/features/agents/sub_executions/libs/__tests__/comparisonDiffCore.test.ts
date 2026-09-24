/**
 * The pure diff core the comparison Web Worker runs.
 *
 * This file exists because of a bundle defect, not a behaviour defect: pulling
 * `jsonDiff` out of `comparisonHelpers` (which reaches `formatCost` → the i18n
 * store → a 14-locale `import.meta.glob`) inlined every locale catalog into the
 * IIFE worker chunk — 23.3 MB, 39.8% of dist's JS.
 *
 * The cut is only safe if the worker path is genuinely locale-INDEPENDENT, so
 * that is what is asserted here, against a non-English active locale rather
 * than in the abstract. The locale-DEPENDENT half of the comparison surface
 * (the numbers rendered beside the diff) stayed on the main thread and is
 * covered in `comparisonHelpers.test.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useI18nStore } from '@/stores/i18nStore';
import { diffLines, jsonDiff } from '../comparisonDiffCore';

const setLanguage = (language: 'en' | 'cs' | 'ja') => useI18nStore.setState({ language });

afterEach(() => setLanguage('en'));

describe('jsonDiff', () => {
  it('reports changed, added and removed keys with stringified values', () => {
    const out = jsonDiff('{"a":1,"b":"x"}', '{"a":2,"c":true}');
    expect(out).toEqual([
      { path: 'a', left: '1', right: '2' },
      { path: 'b', left: '"x"', right: 'null' },
      { path: 'c', left: 'null', right: 'true' },
    ]);
  });

  it('falls back to a (root) entry when neither side parses into keys', () => {
    expect(jsonDiff('not json', 'also not json')).toEqual([
      { path: '(root)', left: 'not json', right: 'also not json' },
    ]);
    expect(jsonDiff(null, null)).toEqual([]);
  });

  it('is byte-identical under a non-English locale — numbers included', () => {
    // 1234.5678 and a date string are exactly the values a locale-aware
    // formatter would rewrite (cs renders that number "1 234,5678"). The diff
    // must hand them through untouched: it reports raw stored values, and the
    // UI formats them later. If this ever diverges, the worker has re-acquired
    // a locale dependency and the 23 MB comes back with it.
    const left = '{"cost":1234.5678,"started":"2026-09-20T10:30:00Z","n":1000000}';
    const right = '{"cost":1234.5679,"started":"2026-09-21T10:30:00Z","n":1000000}';

    setLanguage('en');
    const en = jsonDiff(left, right);
    setLanguage('cs');
    const cs = jsonDiff(left, right);
    setLanguage('ja');
    const ja = jsonDiff(left, right);

    expect(cs).toEqual(en);
    expect(ja).toEqual(en);
    expect(en).toEqual([
      { path: 'cost', left: '1234.5678', right: '1234.5679' },
      { path: 'started', left: '"2026-09-20T10:30:00Z"', right: '"2026-09-21T10:30:00Z"' },
    ]);
  });
});

describe('diffLines', () => {
  it('marks shared lines same, A-only removed, B-only added (appended)', () => {
    expect(diffLines(['a', 'b'], ['b', 'c'])).toEqual([
      { type: 'removed', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'added', text: 'c' },
    ]);
  });

  it('is byte-identical under a non-English locale', () => {
    const a = ['cost 1234.5678', 'Nastavení uloženo', '2026-09-20 10:30:00'];
    const b = ['cost 1234.5679', 'Nastavení uloženo', '2026-09-20 10:30:00'];
    setLanguage('en');
    const en = diffLines(a, b);
    setLanguage('cs');
    expect(diffLines(a, b)).toEqual(en);
    // Non-ASCII text survives the diff unchanged — it is compared, not rendered.
    expect(en.filter((e) => e.type === 'same').map((e) => e.text)).toContain('Nastavení uloženo');
  });
});
