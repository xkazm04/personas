import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const notify = vi.fn(async (_title: string, _body: string) => {});
vi.mock('@/api/system/system', () => ({ sendAppNotification: (...args: unknown[]) => notify(...args) }));
vi.mock('@/stores/systemStore', () => ({ useSystemStore: (selector: (state: { setRebuildActive: () => void }) => unknown) => selector({ setRebuildActive: vi.fn() }) }));

let resolveSnapshot: (snapshot: { status: 'failed'; error: string; lines: string[] }) => void;
const snapshotPromise = new Promise<{ status: 'failed'; error: string; lines: string[] }>((resolve) => { resolveSnapshot = resolve; });
const getSnapshot = vi.fn((_id: string) => snapshotPromise);
const rebuildDesignReview = vi.fn(async (_id: string, _direction?: string): Promise<{ rebuild_id: string }> => ({ rebuild_id: 'rebuild-1' }));
vi.mock('@/api/overview/reviews', () => ({
  rebuildDesignReview: (id: string, direction?: string) => rebuildDesignReview(id, direction),
  getRebuildSnapshot: (id: string) => getSnapshot(id),
  cancelRebuild: vi.fn(async () => {}),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/silentCatch')>()), silentCatch: () => () => {} }));

import { useBackgroundRebuild } from '../useBackgroundRebuild';
import { getEnglishTranslationsAsync } from '@/i18n/useTranslation';

// The templates section is a lazy chunk; load it so the hook's catalog copy resolves.
beforeAll(async () => { await getEnglishTranslationsAsync(); });

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

  it('shows the message of an IPC AppError rejection, not "[object Object]"', async () => {
    // invokeWithTimeout rejects with the serialized AppError envelope, never an Error.
    rebuildDesignReview.mockRejectedValueOnce({ error: 'Review not found', kind: 'NotFound' });
    const { result } = renderHook(() => useBackgroundRebuild());
    await act(async () => result.current.startRebuild('review-2', 'Review'));

    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('Review not found');
  });
});
