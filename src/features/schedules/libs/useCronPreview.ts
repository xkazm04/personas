import { useEffect, useRef, useState } from 'react';
import { previewCronSchedule, cronFireTimesInRange, type CronPreview } from '@/api/pipeline/triggers';

// -- next-N-from-now preview --------------------------------------------------

export interface CronPreviewResult {
  /** Parsed fire-time Dates from the backend, in ascending order. Always UTC-anchored
   *  (Dates carry epoch ms, not zone) — render with explicit `timeZone` option. */
  runs: Date[];
  /** Backend-derived English description, e.g. "Every 5 minutes". */
  description: string;
  valid: boolean;
  error: string | null;
  loading: boolean;
}

const EMPTY: CronPreviewResult = {
  runs: [],
  description: '',
  valid: false,
  error: null,
  loading: false,
};

/**
 * Backend-derived cron preview: next `count` fire times after now, evaluated
 * in `timezone` (IANA name) or system-local when undefined.
 *
 * Single source of truth: defers to `engine/cron.rs` via the
 * `preview_cron_schedule` IPC. The frontend never re-parses cron expressions.
 *
 * Set `cron` to null/empty to clear. Debounce defaults to 300ms.
 */
export function useCronPreview(
  cron: string | null | undefined,
  timezone?: string,
  count = 5,
  debounceMs = 300,
): CronPreviewResult {
  const [result, setResult] = useState<CronPreviewResult>(EMPTY);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const trimmed = cron?.trim();
    if (!trimmed) {
      setResult(EMPTY);
      return;
    }
    const myId = ++reqIdRef.current;
    setResult((prev) => ({ ...prev, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const preview: CronPreview = await previewCronSchedule(trimmed, count, timezone);
        if (myId !== reqIdRef.current) return; // stale
        setResult({
          runs: preview.next_runs.map((s) => new Date(s)),
          description: preview.description,
          valid: preview.valid,
          error: preview.error,
          loading: false,
        });
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setResult({
          ...EMPTY,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [cron, timezone, count, debounceMs]);

  return result;
}

// -- windowed fire-times for the calendar ------------------------------------

export interface CronFireTimesResult {
  runs: Date[];
  loading: boolean;
  error: string | null;
}

const EMPTY_RANGE: CronFireTimesResult = { runs: [], loading: false, error: null };

/**
 * Backend-derived cron fire times within a half-open `[start, end)` window,
 * evaluated in the supplied IANA timezone. Used by the calendar.
 *
 * Stale responses are discarded via a request id ref, so rapid window
 * navigation (clicking through weeks) never paints an older window's events.
 */
export function useCronFireTimesInRange(
  cron: string | null | undefined,
  timezone: string | undefined,
  start: Date,
  end: Date,
  max?: number,
): CronFireTimesResult {
  const [result, setResult] = useState<CronFireTimesResult>(EMPTY_RANGE);
  const reqIdRef = useRef(0);
  const startMs = start.getTime();
  const endMs = end.getTime();

  useEffect(() => {
    const trimmed = cron?.trim();
    if (!trimmed || endMs <= startMs) {
      setResult(EMPTY_RANGE);
      return;
    }
    const myId = ++reqIdRef.current;
    setResult((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const isos = await cronFireTimesInRange(trimmed, timezone, new Date(startMs), new Date(endMs), max);
        if (myId !== reqIdRef.current) return;
        setResult({
          runs: isos.map((s) => new Date(s)),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (myId !== reqIdRef.current) return;
        setResult({
          runs: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [cron, timezone, startMs, endMs, max]);

  return result;
}
