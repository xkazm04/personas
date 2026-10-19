import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';

const getAutoRunStatus = vi.hoisted(() => vi.fn());
const cancelAutoRun = vi.hoisted(() => vi.fn());
const toastCatchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/api/devTools/devTools', () => ({ getAutoRunStatus, cancelAutoRun }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (ctx: string) => (err: unknown) => toastCatchSpy(ctx, err),
}));

import { AutoRunBanner } from '../AutoRunBanner';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['plugins']);
});
beforeEach(() => {
  vi.clearAllMocks();
  getAutoRunStatus.mockResolvedValue({
    runId: 'run-1', projectId: 'p1', status: 'running', live: true,
    snapshotSize: 4, completed: 0, failed: 0, skipped: 0, iterations: 1,
    terminationReason: null, startedAt: '2026-10-19T10:00:00Z', finishedAt: null,
  });
});

describe('AutoRunBanner cancel', () => {
  it('reports a failed cancel instead of letting it escape the click handler', async () => {
    cancelAutoRun.mockRejectedValue({ error: 'auto-run run-1 is not running', kind: 'not_found' });
    render(<AutoRunBanner projectId="p1" />);

    const cancel = await screen.findByRole('button', { name: /cancel auto-run/i });
    fireEvent.click(cancel);

    await waitFor(() => expect(toastCatchSpy).toHaveBeenCalledTimes(1));
    expect(toastCatchSpy.mock.calls[0]![1]).toMatchObject({ kind: 'not_found' });
    // It re-reads the row either way, so the banner shows what really happened.
    await waitFor(() => expect(getAutoRunStatus).toHaveBeenCalledTimes(2));
  });
});
