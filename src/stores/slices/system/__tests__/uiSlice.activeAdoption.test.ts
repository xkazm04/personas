// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createUiSlice } from '../uiSlice';

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createUiSlice as any)(set, get, {}) };
  return { get: () => state as unknown as {
    templateAdoptActive: boolean;
    activeAdoptionReviewId: string | null;
    setTemplateAdoptActive: (active: boolean, reviewId?: string) => void;
  } };
}

describe('uiSlice: the running adoption remembers its review', () => {
  it('keeps the review id while active and clears it when the adoption ends', () => {
    const h = harness();
    h.get().setTemplateAdoptActive(true, 'review-1');
    expect(h.get().activeAdoptionReviewId).toBe('review-1');
    h.get().setTemplateAdoptActive(false);
    expect(h.get().activeAdoptionReviewId).toBeNull();
    expect(h.get().templateAdoptActive).toBe(false);
  });
});
