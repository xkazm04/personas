import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const notify = vi.fn(async (_title: string, _body: string) => {});
vi.mock('@/api/system/system', () => ({ sendAppNotification: (...args: unknown[]) => notify(...args) }));
vi.mock('@/stores/systemStore', () => ({ useSystemStore: (selector: (state: { setRebuildActive: () => void }) => unknown) => selector({ setRebuildActive: vi.fn() }) }));

let resolveSnapshot: (snapshot: { status: 'failed'; error: string; lines: string[] }) => void;
const snapshotPromise = new Promise<{ status: 'failed'; error: string; lines: string[] }>((resolve) => { resolveSnapshot = resolve; });
const getSnapshot = vi.fn((_id: string) => snapshotPromise);
vi.mock('@/api/overview/reviews', () => ({
  rebuildDesignReview: vi.fn(async () => ({ rebuild_id: 'rebuild-1' })),
  getRebuildSnapshot: (id: string) => getSnapshot(id),
  cancelRebuild: vi.fn(async () => {}),
}));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

import { useBackgroundRebuild } from '../useBackgroundRebuild';

describe('useBackgroundRebuild', () => {
  it('ignores a failed snapshot that arrives after user cancellation', async () => {
    const { result } = renderHook(() => useBackgroundRebuild());
    await act(async () => result.current.startRebuild('review-1', 'Review'));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledWith('rebuild-1'));
    await act(async () => result.current.cancelCurrentRebuild());
    await act(async () => resolveSnapshot({ status: 'failed', error: 'Backend cancellation status', lines: [] }));

    expect(result.current.error).toBe('Cancelled by user');
    expect(notify).not.toHaveBeenCalled();
  });
});
