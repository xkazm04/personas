/**
 * A background context scan must settle (sidebar indicator off, Overview
 * process ended) however the component that started it fares. Two defects:
 * the completion listener was mount-scoped, so unmounting the starter (closing
 * AddAppModal, leaving the page) dropped it; and a start failure was handled
 * in a catch that could not run, because the store's scanCodebase reports the
 * failure into state and resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (e: { payload: { scan_id: string; status?: string } }) => void;
const handlers: Handler[] = [];
const unlistenSpy = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name: string, h: Handler) => {
    handlers.push(h);
    return Promise.resolve(() => {
      unlistenSpy();
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    });
  }),
  emit: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => 'denied'),
  sendNotification: vi.fn(),
}));
const t = new Proxy({}, { get: () => new Proxy({}, { get: () => new Proxy({}, { get: (_o, k) => String(k) }) }) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));

import { useSystemStore } from '@/stores/systemStore';
import { useContextScanBackground } from '../useContextScanBackground';

function emit(payload: { scan_id: string; status?: string }) {
  for (const h of [...handlers]) h({ payload });
}

describe('useContextScanBackground', () => {
  beforeEach(() => {
    handlers.length = 0;
    unlistenSpy.mockClear();
    useSystemStore.setState({ contextScanActive: false, contextScanComplete: false });
  });

  it('settles a scan whose starter unmounted before completion', async () => {
    useSystemStore.setState({
      scanCodebase: vi.fn(async () => {
        useSystemStore.setState({ activeScanId: 'scan-1', codebaseScanPhase: 'scanning' });
      }),
    });
    const { result, unmount } = renderHook(() => useContextScanBackground());
    await act(async () => { await result.current.startBackgroundScan('p1', '/repo', 'Repo'); });
    expect(useSystemStore.getState().contextScanActive).toBe(true);

    unmount();
    await act(async () => { await Promise.resolve(); });
    act(() => emit({ scan_id: 'scan-1', status: 'completed_with_warning' }));

    expect(useSystemStore.getState().contextScanActive).toBe(false);
    expect(useSystemStore.getState().contextScanComplete).toBe(true);
  });

  it('ignores another scan finishing, and unlistens once its own scan settles', async () => {
    useSystemStore.setState({
      scanCodebase: vi.fn(async () => {
        useSystemStore.setState({ activeScanId: 'scan-2', codebaseScanPhase: 'scanning' });
      }),
    });
    const { result } = renderHook(() => useContextScanBackground());
    await act(async () => { await result.current.startBackgroundScan('p1', '/repo', 'Repo'); });

    act(() => emit({ scan_id: 'factory-scan', status: 'completed' }));
    expect(useSystemStore.getState().contextScanActive).toBe(true);

    act(() => emit({ scan_id: 'scan-2', status: 'failed' }));
    await act(async () => { await Promise.resolve(); });
    expect(useSystemStore.getState().contextScanActive).toBe(false);
    expect(useSystemStore.getState().contextScanComplete).toBe(false);
    expect(handlers).toHaveLength(0);
  });

  it('settles a start failure the store reported without throwing', async () => {
    useSystemStore.setState({
      scanCodebase: vi.fn(async () => {
        useSystemStore.setState({ codebaseScanPhase: 'error' });
      }),
    });
    const { result } = renderHook(() => useContextScanBackground());
    await act(async () => { await result.current.startBackgroundScan('p1', '/repo', 'Repo'); });

    expect(useSystemStore.getState().contextScanActive).toBe(false);
    expect(useSystemStore.getState().contextScanComplete).toBe(false);
  });
});
