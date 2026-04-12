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
};

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
      const jobId = crypto.randomUUID();
      setExportState({
        status: 'exporting',
        progress: 0,
        jobId,
        outputPath,
        error: null,
      });

      // Subscribe to backend events
      const unsubs: UnlistenFn[] = [];

      unsubs.push(
        await listen<{ job_id: string; progress: number }>(
          EventName.MEDIA_EXPORT_PROGRESS,
          (e) => {
            if (e.payload.job_id !== jobId) return;
            setExportState((prev) => ({ ...prev, progress: e.payload.progress }));
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

  return { exportState, startExport, cancelExport };
}
