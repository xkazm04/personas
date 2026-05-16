import { describe, expect, it } from 'vitest';
import { mergeTagAcross } from '../tagOps';

describe('mergeTagAcross', () => {
  it('appends to an empty tag string', () => {
    expect(mergeTagAcross('', 'forest')).toBe('forest');
  });

  it('appends to a non-empty tag string with comma separator', () => {
    expect(mergeTagAcross('forest, mountain', 'sunset')).toBe('forest, mountain, sunset');
  });

  it('returns the existing string unchanged when tag is already present', () => {
    const existing = 'forest, mountain';
    expect(mergeTagAcross(existing, 'forest')).toBe(existing);
  });

  it('is case-insensitive when de-duping (exact string, not lemma)', () => {
    // Exact-string case-insensitive: "Portraits" and "PORTRAITS" dedup.
    expect(mergeTagAcross('Portraits', 'portraits')).toBe('Portraits');
    expect(mergeTagAcross('portraits', 'PORTRAITS')).toBe('portraits');
    // Different lemmas (singular vs plural) are different tags and append.
    expect(mergeTagAcross('Portraits', 'portrait')).toBe('Portraits, portrait');
  });

  it('trims surrounding whitespace from the new tag', () => {
    expect(mergeTagAcross('forest', '  sunset  ')).toBe('forest, sunset');
  });

  it('returns existing string when new tag is whitespace-only', () => {
    expect(mergeTagAcross('forest', '   ')).toBe('forest');
  });

  it('returns existing string when new tag is empty', () => {
    expect(mergeTagAcross('forest', '')).toBe('forest');
  });

  it('preserves the existing tags exactly when de-duping (no recanonicalization)', () => {
    // If existing has weird spacing, the dedup branch returns the original
    // verbatim — only the append branch goes through `tokens.join(', ')`.
    expect(mergeTagAcross('a ,  b ,c', 'a')).toBe('a ,  b ,c');
  });

  it('skips empty tokens that fall out of split (e.g. trailing comma)', () => {
    // Existing "a,," has one real token "a" plus two empties; appending "b"
    // re-joins only the non-empty tokens.
    expect(mergeTagAcross('a,,', 'b')).toBe('a, b');
  });
});
