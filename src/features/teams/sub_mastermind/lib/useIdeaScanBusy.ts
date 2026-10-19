import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';

/** Activity-drawer domain every idea scan reports under. */
const DOMAIN = 'idea_scan';

/** Release a project's busy marker if no terminal event ever arrives. */
export const IDEA_SCAN_SAFETY_MS = 180_000;

export type IdeaScanOutcome = 'completed' | 'failed' | 'cancelled';

/**
 * What an `IDEA_SCAN_STATUS` status means for the scan, or null while it is
 * still going. The vocabulary is what `IDEA_SCAN_JOBS.set_status` writes in
 * `commands/infrastructure/idea_scanner.rs` (running | completed | failed |
 * cancelled); `completed_with_warning` is the shared background-job word for
 * a success with caveats. Pinned against the Rust source by the hook's test.
 */
export function ideaScanOutcome(status: string): IdeaScanOutcome | null {
  switch (status) {
    case 'completed':
    case 'completed_with_warning':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

/**
 * Per-project busy state for idea scans dispatched from the canvas, keyed by
 * the scan's job id so a terminal event settles exactly the project it belongs
 * to and ends exactly its activity-drawer row.
 *
 * It replaced a set of busy slugs that ANY terminal event cleared wholesale
 * (one project finishing released every other in-flight project) and a drawer
 * row started without a run id and never ended on success, so every scan
 * launched here sat "running" until the 25-minute stale reaper recorded it
 * as failed.
 */
export function useIdeaScanBusy() {
  const [busySlugs, setBusySlugs] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());
  const jobs = useRef(new Map<string, string>());

  const release = useCallback((slug: string) => {
    const timer = timers.current.get(slug);
    if (timer !== undefined) { window.clearTimeout(timer); timers.current.delete(slug); }
    jobs.current.delete(slug);
    setBusySlugs((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => { for (const id of pending.values()) window.clearTimeout(id); pending.clear(); };
  }, []);

  /** Mark a project busy while its dispatch is in flight. */
  const begin = useCallback((slug: string) => {
    setBusySlugs((prev) => new Set(prev).add(slug));
    timers.current.set(slug, window.setTimeout(() => release(slug), IDEA_SCAN_SAFETY_MS));
  }, [release]);

  /** The backend accepted the scan: remember its job and open its drawer row. */
  const attach = useCallback((slug: string, jobId: string, label: string) => {
    jobs.current.set(slug, jobId);
    useOverviewStore.getState().processStarted(DOMAIN, jobId, label, { section: 'plugins', tab: 'skills' });
  }, []);

  /**
   * Apply one status event. Returns null while the scan is still going;
   * otherwise the outcome and the project it settled (null when the scan was
   * not dispatched from here, e.g. from the Idea Scanner page).
   */
  const settle = useCallback((jobId: string, status: string) => {
    const outcome = ideaScanOutcome(status);
    if (!outcome) return null;
    let slug: string | null = null;
    for (const [s, j] of jobs.current) if (j === jobId) { slug = s; break; }
    if (slug !== null) {
      useOverviewStore.getState().processEnded(DOMAIN, outcome, jobId);
      release(slug);
    }
    return { slug, outcome };
  }, [release]);

  return { busySlugs, begin, attach, settle, release };
}
