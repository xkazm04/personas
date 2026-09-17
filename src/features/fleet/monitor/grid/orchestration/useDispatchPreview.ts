// useDispatchPreview — the Orchestration panel's one data hook: the next-tick
// preview, rolled every 30 s (the AutopilotSwitch idiom), paused while the
// tab is hidden, warm across remounts.
//
// READ-ONLY. It used to carry the operator's dispatch order as a locally
// reorderable list plus the write behind it (`useDispatchOrder`, drag + ↑/↓
// + "order by need"). Dispatch-order editing is being replaced by the board
// queue, so the hook now only reads: rows arrive in the order the loop will
// walk them and are shown exactly so. `refresh` stays public because the
// Active switch re-derives every verdict through the loop's own ladder after
// a write rather than guessing here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fleetDispatchPreview } from '@/api/fleet/autopilot';
import { silentCatch } from '@/lib/silentCatch';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';

const POLL_MS = 30_000;

let warm: DispatchPreviewView | null = null;

export interface DispatchPreviewState {
  view: DispatchPreviewView | null;
  /** Rows in the order the loop will walk them (the server's order). */
  rows: DispatchPreviewRow[];
  failed: boolean;
  refresh: () => void;
}

/** The rows the ledger shows for a view — the loop's walk order, untouched. */
export function previewRows(view: DispatchPreviewView | null): DispatchPreviewRow[] {
  return view?.preview.rows ?? [];
}

/** How many rows the next tick refuses outright (the fourth counter). */
export function countHeld(rows: readonly DispatchPreviewRow[]): number {
  return rows.filter((r) => r.verdict.kind === 'refused').length;
}

export function useDispatchPreview(): DispatchPreviewState {
  const [view, setView] = useState<DispatchPreviewView | null>(warm);
  const [failed, setFailed] = useState(false);
  const fetching = useRef(false);
  // A refresh asked for while one is in flight is REMEMBERED, not dropped: the
  // in-flight read may have started before a write (a persona switched off)
  // and would otherwise leave the table showing the old state until the next
  // 30 s poll.
  const again = useRef(false);
  const cancelled = useRef(false);

  const refresh = useCallback(function refresh() {
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    fleetDispatchPreview()
      .then((v) => {
        warm = v;
        if (!cancelled.current) {
          setView(v);
          setFailed(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled.current) setFailed(true);
        silentCatch('monitor/useDispatchPreview')(err);
      })
      .finally(() => {
        fetching.current = false;
        if (again.current && !cancelled.current) {
          again.current = false;
          refresh();
        }
      });
  }, []);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    const tick = () => {
      if (!document.hidden) refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const rows = useMemo(() => previewRows(view), [view]);

  return { view, rows, failed, refresh };
}

/** Test hatch — the warm cache is module state. */
export function _resetDispatchPreviewForTests(): void {
  warm = null;
}
