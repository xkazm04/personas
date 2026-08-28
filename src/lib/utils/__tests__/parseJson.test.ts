import { describe, it, expect } from 'vitest';
import {
  parseJsonOrDefault,
  safeJsonParse,
  hasNonEmptyJson,
  hasRenderableJsonBlob,
} from '../parseJson';

describe('parseJsonOrDefault', () => {
  it('returns the fallback for nullish and malformed input', () => {
    expect(parseJsonOrDefault(null, 'fb')).toBe('fb');
    expect(parseJsonOrDefault('', 'fb')).toBe('fb');
    expect(parseJsonOrDefault('{oops', 'fb')).toBe('fb');
  });

  it('parses well-formed input', () => {
    expect(parseJsonOrDefault('{"a":1}', {})).toEqual({ a: 1 });
  });
});

describe('safeJsonParse', () => {
  it('returns [data, null] on success and [null, Error] on failure', () => {
    expect(safeJsonParse('{"a":1}')).toEqual([{ a: 1 }, null]);
    const [data, err] = safeJsonParse('{oops');
    expect(data).toBeNull();
    expect(err).toBeInstanceOf(Error);
  });

  it('reports a guard rejection without throwing', () => {
    const isNumber = (v: unknown): v is number => typeof v === 'number';
    const [data, err] = safeJsonParse('"text"', isNumber);
    expect(data).toBeNull();
    expect(err?.message).toMatch(/type guard/);
  });
});

describe('hasNonEmptyJson', () => {
  it('answers the shape question for well-formed input', () => {
    expect(hasNonEmptyJson('{"a":1}', 'object')).toBe(true);
    expect(hasNonEmptyJson('{}', 'object')).toBe(false);
    expect(hasNonEmptyJson('[1]', 'array')).toBe(true);
    expect(hasNonEmptyJson('[]', 'array')).toBe(false);
    expect(hasNonEmptyJson('[1]', 'object')).toBe(false);
    expect(hasNonEmptyJson('{"a":1}', 'array')).toBe(false);
    expect(hasNonEmptyJson('null', 'object')).toBe(false);
  });

  it('is false for nullish input in both shapes', () => {
    for (const type of ['object', 'array'] as const) {
      expect(hasNonEmptyJson(null, type)).toBe(false);
      expect(hasNonEmptyJson(undefined, type)).toBe(false);
      expect(hasNonEmptyJson('', type)).toBe(false);
    }
  });

  // Regression guard. The catch read `type === 'object' ? !!raw : false`, so the
  // SAME malformed string answered true when asked about objects and false when
  // asked about arrays — the type parameter deciding whether to trust the input
  // rather than which shape to look for.
  it('gives the same answer for a malformed string whichever shape is asked', () => {
    for (const raw of ['{oops', 'not json at all', '<html>', '{"a":']) {
      expect(hasNonEmptyJson(raw, 'object')).toBe(hasNonEmptyJson(raw, 'array'));
      expect(hasNonEmptyJson(raw, 'object')).toBe(false);
    }
  });
});

describe('hasRenderableJsonBlob', () => {
  // The behaviour the asymmetric catch was really encoding, now under its own
  // name: a blob that does not parse is still displayed verbatim, so a panel
  // gated on it must stay open.
  it('accepts unparseable but non-empty text', () => {
    expect(hasRenderableJsonBlob('not json at all')).toBe(true);
    expect(hasRenderableJsonBlob('{oops')).toBe(true);
  });

  it('rejects empty, nullish and contentless JSON', () => {
    expect(hasRenderableJsonBlob(null)).toBe(false);
    expect(hasRenderableJsonBlob(undefined)).toBe(false);
    expect(hasRenderableJsonBlob('')).toBe(false);
    expect(hasRenderableJsonBlob('{}')).toBe(false);
    expect(hasRenderableJsonBlob('null')).toBe(false);
  });

  it('accepts a non-empty object', () => {
    expect(hasRenderableJsonBlob('{"a":1}')).toBe(true);
  });
});
