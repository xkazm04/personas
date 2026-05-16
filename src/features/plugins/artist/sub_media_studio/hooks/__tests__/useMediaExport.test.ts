import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mockInvokeMap, resetInvokeMocks } from '@/test/tauriMock';

// Bypass the IPC-token wait in tauriInvoke.ts.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';
import {
  emitTauriEvent,
  installTauriEventEmitter,
  listenerCount,
  teardownTauriEventEmitter,
} from '@/test/helpers/tauriEventEmitter';
import { useMediaExport } from '../useMediaExport';
import type { Composition } from '../../types';

const COMPOSITION: Composition = {
  id: 'comp-1',
  name: 'Test composition',
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#000000',
  items: [],
};

beforeEach(() => {
  resetInvokeMocks();
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMediaExport — initial state', () => {
  it('starts idle with progress=0 and no ETA', () => {
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    expect(result.current.exportState.status).toBe('idle');
    expect(result.current.exportState.progress).toBe(0);
    expect(result.current.exportState.etaMs).toBeNull();
    expect(result.current.exportState.startedAt).toBeNull();
  });
});

describe('useMediaExport — startExport', () => {
  it('flips status to exporting and seeds startedAt', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));

    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });

    expect(result.current.exportState.status).toBe('exporting');
    expect(result.current.exportState.outputPath).toBe('/tmp/out.mp4');
    expect(result.current.exportState.startedAt).not.toBeNull();
    expect(result.current.exportState.jobId).not.toBeNull();
  });

  it('subscribes to progress / status / complete events', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    expect(listenerCount('media-export-progress')).toBe(1);
    expect(listenerCount('media-export-status')).toBe(1);
    expect(listenerCount('media-export-complete')).toBe(1);
  });

  it('tears down listeners from a prior in-flight export on re-entry', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/a.mp4');
    });
    expect(listenerCount('media-export-progress')).toBe(1);
    await act(async () => {
      await result.current.startExport('/tmp/b.mp4');
    });
    // Old listener tore down, new one in its place.
    expect(listenerCount('media-export-progress')).toBe(1);
  });
});

describe('useMediaExport — progress event handling', () => {
  it('normalizes a 0-100 percent payload into 0-1 and derives ETA from elapsed', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    // Pin Date.now so elapsedMs math is deterministic. startedAt = 1000,
    // progress event arrives at 3000 → elapsed = 2000ms at 50% → ETA = 2000ms.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });

    const jobId = result.current.exportState.jobId!;
    dateSpy.mockReturnValue(3000);
    act(() => {
      emitTauriEvent('media-export-progress', { job_id: jobId, progress: 50 });
    });

    expect(result.current.exportState.progress).toBeCloseTo(0.5);
    expect(result.current.exportState.elapsedMs).toBe(2000);
    expect(result.current.exportState.etaMs).toBe(2000);
  });

  it('leaves etaMs null while progress is too small to project meaningfully', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    const jobId = result.current.exportState.jobId!;
    act(() => {
      // raw=0.005 stays as 0.005 fraction (normalizer treats it as already 0-1
      // since it's <=1); 0.005 falls below the 0.01 ETA gate.
      emitTauriEvent('media-export-progress', { job_id: jobId, progress: 0.005 });
    });
    expect(result.current.exportState.etaMs).toBeNull();
  });

  it('ignores progress events for a different job id', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    act(() => {
      emitTauriEvent('media-export-progress', { job_id: 'other-job', progress: 80 });
    });
    expect(result.current.exportState.progress).toBe(0);
  });
});

describe('useMediaExport — completion + error + cancel + dismiss', () => {
  it('on complete, snaps progress to 1 and clears etaMs', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    const jobId = result.current.exportState.jobId!;
    act(() => {
      emitTauriEvent('media-export-complete', { job_id: jobId, output_path: '/tmp/out.mp4' });
    });
    await waitFor(() => expect(result.current.exportState.status).toBe('complete'));
    expect(result.current.exportState.progress).toBe(1);
    expect(result.current.exportState.etaMs).toBeNull();
    expect(result.current.exportState.outputPath).toBe('/tmp/out.mp4');
  });

  it('on status:error, flips to error with the message', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    const jobId = result.current.exportState.jobId!;
    act(() => {
      emitTauriEvent('media-export-status', {
        job_id: jobId,
        status: 'error',
        error: 'ffmpeg crashed',
      });
    });
    await waitFor(() => expect(result.current.exportState.status).toBe('error'));
    expect(result.current.exportState.error).toBe('ffmpeg crashed');
  });

  it('cancelExport flips status to cancelled', async () => {
    mockInvokeMap({
      artist_export_composition: { job_id: 'ignored' },
      artist_cancel_export: true,
    });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    await act(async () => {
      await result.current.cancelExport();
    });
    expect(result.current.exportState.status).toBe('cancelled');
  });

  it('dismissExport returns the state to idle', async () => {
    mockInvokeMap({ artist_export_composition: { job_id: 'ignored' } });
    const { result } = renderHook(() => useMediaExport(COMPOSITION));
    await act(async () => {
      await result.current.startExport('/tmp/out.mp4');
    });
    const jobId = result.current.exportState.jobId!;
    act(() => {
      emitTauriEvent('media-export-complete', { job_id: jobId, output_path: '/tmp/out.mp4' });
    });
    await waitFor(() => expect(result.current.exportState.status).toBe('complete'));
    act(() => {
      result.current.dismissExport();
    });
    expect(result.current.exportState.status).toBe('idle');
    expect(result.current.exportState.outputPath).toBeNull();
    expect(result.current.exportState.progress).toBe(0);
  });
});
