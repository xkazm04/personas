/**
 * The review thread's live half.
 *
 * `add_review_message` has emitted `review-message-added` on every write since
 * the command was written and nothing listened, so the thread only ever moved
 * when the panel's own optimistic append moved it. What this pins is the pair
 * of properties the panel's subscriber depends on and that a plain `listen()`
 * would not have given it: the hook subscribes to the RIGHT channel (a typo in
 * the event name is silent in both directions — no error, no message, forever),
 * and it delivers the payload untouched so the subscriber can filter by
 * `review_id` and dedupe by `id` against its own optimistic row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import type { ReviewMessageAddedPayload } from '@/lib/eventRegistry';
import { useReviewMessageAddedListener } from '../useReviewMessageAddedListener';

const listenMock = vi.mocked(listen);

let channel: string | null = null;
let nativeHandler: EventCallback<ReviewMessageAddedPayload> | null = null;

const message = (id: string, reviewId: string): ReviewMessageAddedPayload => ({
  id,
  review_id: reviewId,
  role: 'assistant',
  content: 'looks fine to me',
  created_at: '2026-09-02T10:00:00Z',
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useReviewMessageAddedListener', () => {
  beforeEach(() => {
    channel = null;
    nativeHandler = null;
    vi.stubGlobal('requestAnimationFrame', undefined);
    listenMock.mockImplementation(async (name: string, cb: unknown) => {
      channel = name;
      nativeHandler = cb as EventCallback<ReviewMessageAddedPayload>;
      return () => {};
    });
  });

  afterEach(() => {
    (
      useReviewMessageAddedListener as unknown as { __resetForTests: () => void }
    ).__resetForTests();
    vi.unstubAllGlobals();
    listenMock.mockReset();
  });

  it('subscribes to the channel add_review_message emits on', async () => {
    renderHook(() => useReviewMessageAddedListener(() => {}));
    await flush();
    // The wire name in src-tauri/core/src/events.rs, not a paraphrase of it.
    expect(channel).toBe('review-message-added');
  });

  it('hands the subscriber the payload it needs to filter and dedupe', async () => {
    const seen: ReviewMessageAddedPayload[] = [];
    renderHook(() => useReviewMessageAddedListener((m) => seen.push(m)));
    await flush();

    const mine = message('m-1', 'review-a');
    const other = message('m-2', 'review-b');
    act(() => {
      nativeHandler?.({ event: 'review-message-added', id: 1, payload: mine });
      nativeHandler?.({ event: 'review-message-added', id: 2, payload: other });
    });
    await flush();

    // One singleton serves whichever review is open, so BOTH arrive and the
    // review_id/id the subscriber filters on must survive the trip intact.
    expect(seen).toEqual([mine, other]);
  });
});
