// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeCloudReview } from '../sanitizeCloudReview';

describe('sanitizeCloudReview', () => {
  it('strips bidi overrides and zero-width chars', () => {
    expect(sanitizeCloudReview('a\u202Eb\u200Bc', null).content).toBe('abc');
  });

  // Isolates reorder text like overrides do; C1 controls and the Arabic letter
  // mark are refused by sanitizeUrl.ts's hasUnsafeCodepoints but passed here.
  it.each([
    ['LRI/RLI/FSI/PDI isolates', '\u2066\u2067\u2068\u2069'],
    ['C1 controls', '\u0085\u009B'],
    ['Arabic letter mark', '\u061C'],
    ['word joiner', '\u2060'],
  ])('strips %s from content, title and notes', (_label, chars) => {
    const out = sanitizeCloudReview(`Approve${chars} refund`, `ok${chars}`);
    expect(out.content).toBe('Approve refund');
    expect(out.title).toBe('Approve refund');
    expect(out.reviewerNotes).toBe('ok');
  });

  it('keeps tabs, newlines and non-Latin text', () => {
    expect(sanitizeCloudReview('Schválit\tvrácení\nřádek 2', null).content).toBe('Schválit\tvrácení\nřádek 2');
  });
});
