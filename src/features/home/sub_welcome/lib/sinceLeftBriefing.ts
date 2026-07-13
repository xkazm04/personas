/**
 * "Since you left" briefing — a compact debrief of what happened while the user
 * was away, shown on the Home Welcome surface.
 *
 * Every delta is derived from data the Overview spine already holds (see
 * homeSpineSlice + alertSlice), so the briefing issues NO new IPC of its own —
 * it only triggers the shared store fetches when cold:
 *   - runs (and how many failed) since the last visit  → homeRunsSample
 *   - alerts raised since the last visit                → alertHistory
 *   - approvals currently waiting                       → pendingReviewCount
 *
 * The "last visit" anchor is a timestamp persisted in localStorage, advanced on
 * an interval + on unload/hide so the NEXT open compares against the end of this
 * session. The briefing stays quiet when nothing happened or on first ever run.
 */
import { useEffect, useMemo, useState } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import type { RunSample } from '@/stores/slices/overview/homeSpineWindows';
import { silentCatch } from '@/lib/silentCatch';

const LAST_SEEN_KEY = 'personas:home-last-seen';
const HEARTBEAT_MS = 60_000;

export type BriefingKind = 'runs' | 'alerts' | 'approvals';

export interface BriefingLine {
  kind: BriefingKind;
  count: number;
  /** For `runs` only: how many of `count` failed. */
  failed?: number;
}

export interface BriefingInput {
  runs: readonly RunSample[] | null;
  alerts: ReadonlyArray<{ fired_at: string }>;
  approvalsWaiting: number;
}

export interface SinceLeftBriefing {
  lines: BriefingLine[];
  /** True when there's no prior anchor (first ever run) — render nothing. */
  firstRun: boolean;
}

/**
 * Pure delta computation. `lastSeen` is the previous session's end timestamp
 * (epoch ms) or `null` on first run. Only non-empty signals produce a line, and
 * "approvals waiting" is a current-state count (not a since-lastSeen delta).
 */
export function computeSinceLeftBriefing(
  input: BriefingInput,
  lastSeen: number | null,
): SinceLeftBriefing {
  if (lastSeen == null) return { lines: [], firstRun: true };

  const lines: BriefingLine[] = [];

  // Runs since last visit (+ how many failed).
  if (input.runs) {
    let runs = 0;
    let failed = 0;
    for (const r of input.runs) {
      const ts = Date.parse(r.created_at);
      if (Number.isNaN(ts) || ts <= lastSeen) continue;
      runs++;
      if (r.status === 'failed') failed++;
    }
    if (runs > 0) lines.push({ kind: 'runs', count: runs, failed });
  }

  // Alerts raised since last visit.
  let alerts = 0;
  for (const a of input.alerts) {
    const ts = Date.parse(a.fired_at);
    if (!Number.isNaN(ts) && ts > lastSeen) alerts++;
  }
  if (alerts > 0) lines.push({ kind: 'alerts', count: alerts });

  // Approvals waiting (current state).
  if (input.approvalsWaiting > 0) {
    lines.push({ kind: 'approvals', count: input.approvalsWaiting });
  }

  return { lines, firstRun: false };
}

export function readLastSeen(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLastSeen(ts: number): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(ts));
  } catch (err) {
    silentCatch('sinceLeftBriefing:writeLastSeen')(err);
  }
}

export interface UseSinceLeftBriefing {
  lines: BriefingLine[];
  visible: boolean;
  dismiss: () => void;
}

export function useSinceLeftBriefing(): UseSinceLeftBriefing {
  // Freeze the previous-session anchor at first render, before the heartbeat
  // below advances the stored value for the next session.
  const [anchor] = useState<number | null>(() => readLastSeen());
  const [dismissed, setDismissed] = useState(false);

  const runs = useOverviewStore((s) => s.homeRunsSample);
  const alerts = useOverviewStore((s) => s.alertHistory);
  const approvalsWaiting = useOverviewStore((s) => s.pendingReviewCount);

  // Trigger the shared fetches when cold (all TTL-guarded → cheap, deduped).
  useEffect(() => {
    const st = useOverviewStore.getState();
    st.primeHomeSpine();
    void st.fetchPendingReviewCount();
    void st.fetchAlertHistory();
  }, []);

  // Advance the stored anchor to "now" on a slow heartbeat + on unload/hide, so
  // the next open compares against the end of this session.
  useEffect(() => {
    const beat = () => writeLastSeen(Date.now());
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    const onHide = () => { if (document.hidden) beat(); };
    window.addEventListener('beforeunload', beat);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', beat);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  const { lines, firstRun } = useMemo(
    () => computeSinceLeftBriefing({ runs, alerts, approvalsWaiting }, anchor),
    [runs, alerts, approvalsWaiting, anchor],
  );

  const dismiss = () => {
    writeLastSeen(Date.now());
    setDismissed(true);
  };

  const visible = !dismissed && !firstRun && lines.length > 0;
  return { lines: visible ? lines : [], visible, dismiss };
}
