import { describe, it, expect } from 'vitest';
import {
  clampDraftPatch,
  MIN_PERSONA_MAX_CONCURRENT,
  MAX_PERSONA_MAX_CONCURRENT,
  MIN_PERSONA_TIMEOUT_MS,
  MAX_PERSONA_TIMEOUT_MS,
} from '../PersonaDraft';

describe('clampDraftPatch', () => {
  it('clamps maxConcurrent at the patch door, not in the control', () => {
    // The control's spinner limits are an affordance, not enforcement: a
    // programmatic patch, a paste, or the next writer added to this draft
    // never passes through them. The door does.
    expect(clampDraftPatch({ maxConcurrent: 999 }).maxConcurrent).toBe(MAX_PERSONA_MAX_CONCURRENT);
    expect(clampDraftPatch({ maxConcurrent: 0 }).maxConcurrent).toBe(MIN_PERSONA_MAX_CONCURRENT);
    expect(clampDraftPatch({ maxConcurrent: 3 }).maxConcurrent).toBe(3);
  });

  it('clamps timeout to the engine ceiling the definition names', () => {
    expect(clampDraftPatch({ timeout: 99_000_000 }).timeout).toBe(MAX_PERSONA_TIMEOUT_MS);
    expect(clampDraftPatch({ timeout: 1 }).timeout).toBe(MIN_PERSONA_TIMEOUT_MS);
  });

  it('leaves fields the patch does not mention alone', () => {
    const patch = clampDraftPatch({ name: 'x' });
    expect(patch).toEqual({ name: 'x' });
    expect('maxConcurrent' in patch).toBe(false);
  });

  it('rounds a fractional concurrency rather than persisting half a slot', () => {
    expect(clampDraftPatch({ maxConcurrent: 2.6 }).maxConcurrent).toBe(3);
  });
});
