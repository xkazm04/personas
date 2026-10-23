/**
 * A failed scheduler start/pause reaches the user.
 *
 * The header switch caught a rejected start_scheduler / stop_scheduler with
 * silentCatch, so pressing it on a refusal changed nothing on screen and said
 * nothing: the operator could not tell a paused engine from a failed pause.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toastSpy = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: vi.fn(() => toastSpy),
}));
vi.mock('@/hooks/utility/useElementVisible', () => ({
  useElementVisible: () => [{ current: null }, true],
}));
vi.mock('@/lib/eventRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/eventRegistry')>()),
  typedListen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: unknown) => unknown) =>
    sel({ cronAgents: [], cronAgentsLoading: false, fetchCronAgents: () => Promise.resolve() }),
}));
vi.mock('@/api/pipeline/scheduler', () => ({
  getSchedulerStatus: vi.fn(() => Promise.resolve({ running: true })),
  stopScheduler: vi.fn(() => Promise.reject({ error: 'scheduler busy', kind: 'internal' })),
  startScheduler: vi.fn(() => Promise.resolve({ running: true })),
}));

const { default: SchedulesOverlay } = await import('../../components/SchedulesOverlay');

describe('scheduler engine switch', () => {
  it('surfaces a refused pause to the user', async () => {
    const { getActiveTranslations } = await import('@/i18n/useTranslation');
    render(<SchedulesOverlay />);
    const engineOn = getActiveTranslations().schedules?.engine_on ?? 'Engine On';
    const button = await screen.findByRole('button', { name: new RegExp(engineOn) });
    fireEvent.click(button);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy.mock.calls[0]![0]).toEqual({ error: 'scheduler busy', kind: 'internal' });
  });
});
