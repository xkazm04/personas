import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { flushThrottledStorage } from '@/lib/throttledStorage';
import {
  useAdoptionAnswerSnapshot,
  readAnswerSnapshot,
  writeAnswerSnapshot,
  clearAnswerSnapshot,
  SNAPSHOT_TTL_MS,
} from '../useAdoptionAnswerSnapshot';

const REVIEW = 'review-a';
const OTHER = 'review-b';

describe('adoption answer snapshot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the answers a closed interview left behind', () => {
    writeAnswerSnapshot(REVIEW, { q1: 'daily', q2: 'ops' });
    flushThrottledStorage();
    const { result } = renderHook(() => useAdoptionAnswerSnapshot(REVIEW));
    expect(result.current.restored).toEqual({ q1: 'daily', q2: 'ops' });
  });

  it('starts empty for a review that was never answered', () => {
    const { result } = renderHook(() => useAdoptionAnswerSnapshot(OTHER));
    expect(result.current.restored).toEqual({});
  });

  it('keeps each review in its own slot', () => {
    writeAnswerSnapshot(REVIEW, { q1: 'a' });
    writeAnswerSnapshot(OTHER, { q1: 'b' });
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW)).toEqual({ q1: 'a' });
    expect(readAnswerSnapshot(OTHER)).toEqual({ q1: 'b' });
  });

  it('saves through the hook and reads back on a fresh mount', () => {
    const first = renderHook(() => useAdoptionAnswerSnapshot(REVIEW));
    act(() => first.result.current.save({ q1: 'weekly' }));
    flushThrottledStorage();
    first.unmount();

    const second = renderHook(() => useAdoptionAnswerSnapshot(REVIEW));
    expect(second.result.current.restored).toEqual({ q1: 'weekly' });
  });

  it('drops the snapshot once the interview is committed', () => {
    writeAnswerSnapshot(REVIEW, { q1: 'a' });
    flushThrottledStorage();
    const { result } = renderHook(() => useAdoptionAnswerSnapshot(REVIEW));
    act(() => result.current.clear());
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW)).toEqual({});
  });

  it('refuses to re-save after clear, so Continue is a real commit boundary', () => {
    const { result } = renderHook(() => useAdoptionAnswerSnapshot(REVIEW));
    act(() => result.current.clear());
    act(() => result.current.save({ q1: 'late' }));
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW)).toEqual({});
  });

  it('treats an answer set past its TTL as a different intent, not a resumption', () => {
    writeAnswerSnapshot(REVIEW, { q1: 'stale' });
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW, Date.now() + SNAPSHOT_TTL_MS + 1)).toEqual({});
    // And the stale entry is not left behind to be re-read.
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW)).toEqual({});
  });

  it('survives a malformed payload rather than throwing into adoption', () => {
    window.localStorage.setItem('template-adoption-answers-v1:review-a', '{not json');
    expect(readAnswerSnapshot(REVIEW)).toEqual({});
  });

  it('removes the key when the answers go back to empty', () => {
    writeAnswerSnapshot(REVIEW, { q1: 'a' });
    flushThrottledStorage();
    writeAnswerSnapshot(REVIEW, {});
    flushThrottledStorage();
    expect(readAnswerSnapshot(REVIEW)).toEqual({});
    clearAnswerSnapshot(REVIEW);
  });
});
