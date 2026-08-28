import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Studio's preview runs `next dev`, so a project that is not a Next.js app
// cannot be opened. That guard existed on the browse-a-folder path only. The
// picker leaned on an advisory probe rendered in the tab strip, and the probe's
// FAILURE path wrote no state — leaving `nextReady` as `{}`, so `=== false` was
// false for every row and the whole list read as openable. The click then failed
// later, deeper, and with an unrelated error.
//
// These pin the corrected direction: a check that could not be RUN refuses, the
// same way a check that ran and said "no" refuses.

const webbuildNextReady = vi.fn<(ids: string[]) => Promise<string[]>>();
const webbuildDevStart = vi.fn();
const toastCatch = vi.fn(() => vi.fn());

vi.mock('@/api/webbuild', () => ({
  webbuildNextReady: (ids: string[]) => webbuildNextReady(ids),
  webbuildDevStart: (id: string) => webbuildDevStart(id),
  webbuildDevStop: vi.fn(),
  webbuildListProjects: vi.fn(async () => []),
  webbuildRegisterExisting: vi.fn(),
  webbuildScaffold: vi.fn(),
  webbuildSessionSend: vi.fn(),
  webbuildSessionStop: vi.fn(),
  webbuildStatus: vi.fn(async () => null),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => vi.fn(),
  toastCatch: (label: string) => toastCatch(label),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

const { useStudioStore } = await import('../studioStore');

const OPEN = { id: 'p1', name: 'Some project' };

describe('openImportable (the picker and the browse path share one refusal)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
    webbuildNextReady.mockReset();
    webbuildDevStart.mockReset();
    toastCatch.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('opens a project the probe confirms is a Next.js app', async () => {
    webbuildNextReady.mockResolvedValue([OPEN.id]);
    webbuildDevStart.mockResolvedValue({ healthy: false, url: '' });

    await useStudioStore.getState().openImportable(OPEN.id, OPEN.name);

    expect(useStudioStore.getState().tabOrder).toEqual([OPEN.id]);
    expect(webbuildDevStart).toHaveBeenCalledWith(OPEN.id);
  });

  it('refuses a project the probe says is not a Next.js app', async () => {
    webbuildNextReady.mockResolvedValue([]);

    await useStudioStore.getState().openImportable(OPEN.id, OPEN.name);

    expect(useStudioStore.getState().tabOrder).toEqual([]);
    expect(webbuildDevStart).not.toHaveBeenCalled();
    expect(toastCatch).toHaveBeenCalled();
  });

  it('refuses — rather than degrading open — when the probe itself FAILS', async () => {
    // The regression this file exists for. A check we could not run is not a
    // project we may open; "unknown" is not "fine".
    webbuildNextReady.mockRejectedValue(new Error('IPC timeout'));

    await useStudioStore.getState().openImportable(OPEN.id, OPEN.name);

    expect(useStudioStore.getState().tabOrder).toEqual([]);
    expect(webbuildDevStart).not.toHaveBeenCalled();
    expect(toastCatch).toHaveBeenCalled();
  });

  it('never starts a dev server it has not cleared — on either refusal path', async () => {
    webbuildNextReady.mockRejectedValueOnce(new Error('IPC timeout'));
    await useStudioStore.getState().openImportable(OPEN.id, OPEN.name);
    webbuildNextReady.mockResolvedValueOnce([]);
    await useStudioStore.getState().openImportable('p2', 'Another');

    expect(webbuildDevStart).not.toHaveBeenCalled();
    expect(useStudioStore.getState().tabOrder).toEqual([]);
  });
});
