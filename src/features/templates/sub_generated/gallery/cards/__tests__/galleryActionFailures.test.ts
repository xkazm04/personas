import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const toastHandler = vi.fn();
const toastCatch = vi.fn((_context: string) => toastHandler);
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (context: string) => toastCatch(context),
}));

const deleteDesignReview = vi.fn();
const cleanupDuplicateReviews = vi.fn();
vi.mock('@/api/overview/reviews', () => ({
  deleteDesignReview: (id: string) => deleteDesignReview(id),
  cleanupDuplicateReviews: () => cleanupDuplicateReviews(),
  backfillServiceFlow: vi.fn(async () => {}),
  backfillRelatedTools: vi.fn(async () => {}),
}));
vi.mock('../../../shared/useConnectorReadiness', () => ({
  useConnectorReadiness: () => ({ readiness: new Map() }),
}));

import { useGalleryActions } from '../useGalleryActions';

// invokeWithTimeout rejects with a serialized AppError object, not an Error.
const IPC_REJECTION = { error: 'database is locked', kind: 'Database' };

describe('gallery admin actions report failures', () => {
  beforeEach(() => {
    toastHandler.mockReset();
    toastCatch.mockClear();
    deleteDesignReview.mockReset();
    cleanupDuplicateReviews.mockReset();
  });

  it('a failed template delete reaches the toast door and skips the refresh', async () => {
    deleteDesignReview.mockRejectedValue(IPC_REJECTION);
    const refresh = vi.fn();
    const { result } = renderHook(() => useGalleryActions([], 0, 'recent', [], [], refresh));
    await act(async () => { await result.current.handleDeleteReview('r1'); });
    expect(toastHandler).toHaveBeenCalledWith(IPC_REJECTION);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a failed duplicate cleanup reaches the toast door and clears its busy flag', async () => {
    cleanupDuplicateReviews.mockRejectedValue(IPC_REJECTION);
    const { result } = renderHook(() => useGalleryActions([], 0, 'recent', [], [], vi.fn()));
    await act(async () => { await result.current.handleCleanupDuplicates(); });
    expect(toastHandler).toHaveBeenCalledWith(IPC_REJECTION);
    expect(result.current.isCleaningUp).toBe(false);
  });

  it('keeps handleDeleteReview stable across renders (it is a memoized row prop)', () => {
    const refresh = vi.fn();
    const { result, rerender } = renderHook(() => useGalleryActions([], 0, 'recent', [], [], refresh));
    const first = result.current.handleDeleteReview;
    rerender();
    expect(result.current.handleDeleteReview).toBe(first);
  });
});
