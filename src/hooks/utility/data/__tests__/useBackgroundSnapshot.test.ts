import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useBackgroundSnapshot,
  type SnapshotLike,
  type UseBackgroundSnapshotOptions,
} from '../useBackgroundSnapshot';

function runningSnapshot(): SnapshotLike {
  // A fresh `lines` array each poll — this is what real backends return and
  // what makes a consumer's `setLines(lines)` re-render on every poll.
  return { status: 'running', error: null, lines: ['tick'] };
}

/**
 * Build the options object the way every real consumer does: inline closures
 * that get a fresh identity on each render (their own `useCallback`s close
 * over a prop the parent passes inline).
 */
function freshOptions(
  snapshotId: string | null,
  getSnapshot: (id: string) => Promise<SnapshotLike>,
  extra?: Partial<UseBackgroundSnapshotOptions>,
): UseBackgroundSnapshotOptions {
  return {
    snapshotId,
    getSnapshot,
    onLines: () => {},
    onPhase: () => {},
    onDraft: () => {},
    onCompletedNoDraft: () => {},
    onFailed: () => {},
    onSessionLost: () => {},
    interval: 5000,
    ...extra,
  };
}

describe('useBackgroundSnapshot', () => {
  it('does not re-poll when only callback identities change', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(runningSnapshot());

    const { rerender } = renderHook(
      () => useBackgroundSnapshot(freshOptions('job-1', getSnapshot)),
    );

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));

    // Five parent re-renders, each handing the hook brand-new closures. The
    // 5000 ms interval means no scheduled poll can be due yet, so any extra
    // call is the effect restarting on a callback identity.
    for (let i = 0; i < 5; i += 1) rerender();
    await new Promise((r) => setTimeout(r, 30));

    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('restarts polling when the snapshot id changes', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(runningSnapshot());

    const { rerender } = renderHook(
      ({ id }: { id: string }) => useBackgroundSnapshot(freshOptions(id, getSnapshot)),
      { initialProps: { id: 'job-1' } },
    );

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));
    expect(getSnapshot).toHaveBeenCalledWith('job-1');

    rerender({ id: 'job-2' });
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(getSnapshot).toHaveBeenLastCalledWith('job-2');
  });

  it('uses the latest callbacks even though the effect no longer depends on them', async () => {
    let resolveFirst: (s: SnapshotLike) => void = () => {};
    const getSnapshot = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<SnapshotLike>((res) => { resolveFirst = res; }),
      );

    const stale = vi.fn();
    const fresh = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: (lines: string[]) => void }) =>
        useBackgroundSnapshot(freshOptions('job-1', getSnapshot, { onLines: cb })),
      { initialProps: { cb: stale } },
    );

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));

    // Swap the callback while the first poll is still in flight.
    rerender({ cb: fresh });
    resolveFirst(runningSnapshot());

    await waitFor(() => expect(fresh).toHaveBeenCalledWith(['tick']));
    expect(stale).not.toHaveBeenCalled();
  });

  it('reports session loss after maxFailures consecutive fetch errors', async () => {
    const getSnapshot = vi.fn().mockRejectedValue(new Error('gone'));
    const onSessionLost = vi.fn();

    renderHook(() =>
      useBackgroundSnapshot(
        freshOptions('job-1', getSnapshot, {
          onSessionLost,
          maxFailures: 2,
          // Backoff floors at MIN_BACKOFF_MS regardless, but a small interval
          // keeps the first retry at the floor rather than higher.
          interval: 1,
        }),
      ),
    );

    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSessionLost).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });
});
