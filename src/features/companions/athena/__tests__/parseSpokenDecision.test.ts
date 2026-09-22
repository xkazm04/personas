import { describe, it, expect } from 'vitest';
import { parseSpokenDecision } from '../decision/parseSpokenDecision';

/**
 * Slice 7 — spoken-number answering.
 *
 * `parseSpokenDecision(transcript, optionCount)` maps a final STT transcript to
 * a decision answer (option index / explain) or `null` (not a decision answer →
 * fall through to a normal chat turn). These tests pin that contract:
 * `useHoldToTalk` branches on exactly this return.
 */
describe('parseSpokenDecision (slice 7)', () => {
  it('maps the number word "one" to option index 0', () => {
    expect(parseSpokenDecision('one', 3)).toEqual({ kind: 'option', index: 0 });
  });

  it('maps the digit "3" to option index 2', () => {
    expect(parseSpokenDecision('3', 3)).toEqual({ kind: 'option', index: 2 });
  });

  it('maps "zero" to the explain sentinel', () => {
    expect(parseSpokenDecision('zero', 3)).toEqual({ kind: 'explain' });
  });

  it('maps "0" to the explain sentinel', () => {
    expect(parseSpokenDecision('0', 3)).toEqual({ kind: 'explain' });
  });

  it('maps "explain" to the explain sentinel', () => {
    expect(parseSpokenDecision('explain', 3)).toEqual({ kind: 'explain' });
  });

  it('returns null for a non-numeric sentence ("deploy the thing")', () => {
    expect(parseSpokenDecision('deploy the thing', 3)).toBeNull();
  });

  it('returns null for an out-of-range choice (digit)', () => {
    expect(parseSpokenDecision('5', 2)).toBeNull();
  });

  it('returns null for an out-of-range choice (word)', () => {
    expect(parseSpokenDecision('seven', 3)).toBeNull();
  });

  it('tolerates trailing punctuation / casing / whitespace from STT', () => {
    expect(parseSpokenDecision('  Two. ', 3)).toEqual({ kind: 'option', index: 1 });
    expect(parseSpokenDecision('Explain!', 3)).toEqual({ kind: 'explain' });
  });

  it('returns null for an empty / whitespace-only transcript', () => {
    expect(parseSpokenDecision('', 3)).toBeNull();
    expect(parseSpokenDecision('   ', 3)).toBeNull();
  });
});
