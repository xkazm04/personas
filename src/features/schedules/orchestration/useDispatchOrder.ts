// useDispatchOrder — the Orchestration tab's one data hook, shared by every
// variant: the next-tick preview (rolled every 30 s, the AutopilotSwitch
// idiom), the operator's order as a locally reorderable list, and the write.
//
// THE ORDER IS THE WHOLE LIST. A drop persists every persona's position, so
// after the first drag nobody is "unranked" any more — that is the point: a
// list position is the only structure that preserves a place for certain. The
// preview is refetched right after the write so every verdict (who starts,
// who waits) is re-derived by the loop's own ladder rather than guessed here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fleetDispatchPreview, setFleetDispatchOrder } from '@/api/fleet/autopilot';
import { silentCatch } from '@/lib/silentCatch';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';

const POLL_MS = 30_000;

let warm: DispatchPreviewView | null = null;

export interface DispatchOrderState {
  view: DispatchPreviewView | null;
  /** Rows in the order currently shown (server order, then local drags). */
  rows: DispatchPreviewRow[];
  failed: boolean;
  saving: boolean;
  /** Replace the shown order (a drag) and persist it. */
  reorder: (personaIds: string[]) => void;
  /** Move one persona a step — the keyboard alternative to dragging. */
  move: (personaId: string, delta: -1 | 1) => void;
  /** Rank nobody: back to pure least-recently-served. */
  reset: () => void;
  refresh: () => void;
}

/** Reorder `rows` to follow `ids`; rows not named keep their relative order after the named ones. */
export function applyOrder(rows: readonly DispatchPreviewRow[], ids: readonly string[]): DispatchPreviewRow[] {
  const byId = new Map(rows.map((r) => [r.personaId, r]));
  const seen = new Set<string>();
  const named: DispatchPreviewRow[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r && !seen.has(id)) {
      seen.add(id);
      named.push(r);
    }
  }
  return [...named, ...rows.filter((r) => !seen.has(r.personaId))];
}

export function useDispatchOrder(): DispatchOrderState {
  const [view, setView] = useState<DispatchPreviewView | null>(warm);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const fetching = useRef(false);
  // A refresh asked for while one is in flight is REMEMBERED, not dropped: the
  // in-flight read may have started before a write (a reorder, a persona
  // switched off) and would otherwise leave the table showing the old state
  // until the next 30 s poll.
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
          setLocalOrder(null); // the server's walk is the truth again
          setFailed(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled.current) setFailed(true);
        silentCatch('schedules/useDispatchOrder')(err);
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

  const rows = useMemo(() => {
    const base = view?.preview.rows ?? [];
    return localOrder ? applyOrder(base, localOrder) : base;
  }, [view, localOrder]);

  const persist = useCallback(
    (ids: string[]) => {
      setSaving(true);
      setFleetDispatchOrder(ids)
        .then(() => refresh())
        .catch((err: unknown) => {
          silentCatch('schedules/useDispatchOrder:persist')(err);
          if (!cancelled.current) setFailed(true);
        })
        .finally(() => {
          if (!cancelled.current) setSaving(false);
        });
    },
    [refresh],
  );

  const reorder = useCallback(
    (ids: string[]) => {
      setLocalOrder(ids);
      persist(ids);
    },
    [persist],
  );

  const move = useCallback(
    (personaId: string, delta: -1 | 1) => {
      const ids = rows.map((r) => r.personaId);
      const i = ids.indexOf(personaId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      reorder(ids);
    },
    [rows, reorder],
  );

  const reset = useCallback(() => {
    setLocalOrder(null);
    persist([]);
  }, [persist]);

  return { view, rows, failed, saving, reorder, move, reset, refresh };
}
