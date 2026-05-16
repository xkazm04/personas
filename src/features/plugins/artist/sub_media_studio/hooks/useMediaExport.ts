import { useState, useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  artistExportComposition,
  artistCancelExport,
} from '@/api/artist/index';
import { EventName } from '@/lib/eventRegistry';
import type { Composition, ExportState } from '../types';

const IDLE_STATE: ExportState = {
  status: 'idle',
  progress: 0,
  jobId: null,
  outputPath: null,
  error: null,
  startedAt: null,
  elapsedMs: 0,
  etaMs: null,
};

// Backend emits progress as a percent (0–100, clamped) — normalize to a 0–1
// fraction so callers can treat ExportState.progress consistently across UI
// surfaces. Clamp defensively in case the source ever drifts.
function normalizeProgress(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const fraction = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Manages an FFmpeg export job — progress, cancel, completion.
 */
export function useMediaExport(composition: Composition) {
  const [exportState, setExportState] = useState<ExportState>(IDLE_STATE);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unlistenersRef.current.forEach((u) => u());
      unlistenersRef.current = [];
    };
  }, []);

  const startExport = useCallback(
    async (outputPath: string) => {
      // Tear down any listeners from a prior in-flight export before starting
      // a new one. Without this, re-entrant startExport (e.g. user clicks
      // Export twice or restarts after an error) overwrote unlistenersRef
      // with the new subscription set, leaving the prior set unreferenced
      // and forever fed events for a job nobody is watching.
      const previousUnsubs = unlistenersRef.current;
      unlistenersRef.current = [];
      previousUnsubs.forEach((u) => u());

      const jobId = crypto.randomUUID();
      const startedAt = Date.now();
      setExportState({
        status: 'exporting',
        progress: 0,
        jobId,
        outputPath,
        error: null,
        startedAt,
        elapsedMs: 0,
        etaMs: null,
      });

      // Subscribe to backend events
      const unsubs: UnlistenFn[] = [];

      unsubs.push(
        await listen<{ job_id: string; progress: number; time?: number }>(
          EventName.MEDIA_EXPORT_PROGRESS,
          (e) => {
            if (e.payload.job_id !== jobId) return;
            const progress = normalizeProgress(e.payload.progress);
            const elapsedMs = Date.now() - startedAt;
            // Need at least ~1% real progress before the linear ETA stops being
            // noise — otherwise an early tick gives 100× overestimates.
            const etaMs =
              progress > 0.01 && progress < 1
                ? Math.max(0, (elapsedMs * (1 - progress)) / progress)
                : null;
            setExportState((prev) => ({ ...prev, progress, elapsedMs, etaMs }));
          },
        ),
      );

      unsubs.push(
        await listen<{ job_id: string; status: string; error?: string }>(
          EventName.MEDIA_EXPORT_STATUS,
          (e) => {
            if (e.payload.job_id !== jobId) return;
            if (e.payload.status === 'error') {
              setExportState((prev) => ({
                ...prev,
                status: 'error',
                error: e.payload.error ?? 'Unknown error',
              }));
              unsubs.forEach((u) => u());
            }
          },
        ),
      );

      unsubs.push(
        await listen<{ job_id: string; output_path: string }>(
          EventName.MEDIA_EXPORT_COMPLETE,
          (e) => {
            if (e.payload.job_id !== jobId) return;
            setExportState((prev) => ({
              ...prev,
              status: 'complete',
              progress: 1,
              outputPath: e.payload.output_path,
              etaMs: null,
            }));
            unsubs.forEach((u) => u());
          },
        ),
      );

      unlistenersRef.current = unsubs;

      try {
        const compositionJson = JSON.stringify(composition);
        await artistExportComposition(jobId, compositionJson, outputPath);
      } catch (err) {
        setExportState((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
        unsubs.forEach((u) => u());
      }
    },
    [composition],
  );

  const cancelExport = useCallback(async () => {
    if (exportState.jobId) {
      try {
        await artistCancelExport(exportState.jobId);
      } catch {
        // best-effort cancel
      }
    }
    unlistenersRef.current.forEach((u) => u());
    unlistenersRef.current = [];
    setExportState((prev) => ({ ...prev, status: 'cancelled' }));
  }, [exportState.jobId]);

  const dismissExport = useCallback(() => {
    setExportState(IDLE_STATE);
  }, []);

  return { exportState, startExport, cancelExport, dismissExport };
}
