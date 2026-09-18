// useLocalOrder — the optimistic queue between a drop and its confirmation.
//
// A drag ends, the door is asked for the new order, and 150 ms plus one IPC
// later the snapshot says so. In between, the board paints the order the
// operator just made — with ranks renumbered and starts re-estimated from
// the mean the last snapshot implied — and drops that local copy the moment
// a new snapshot arrives (the `queued` prop changes identity per model
// rebuild). A failed reorder also drops it, so the board snaps back to what
// the door still holds rather than lying until the next poll.

import { useCallback, useEffect, useState } from 'react';
import { applyOrder, dropPayload, meanWaitMs, reEstimate, reorderPayload, nudgePayload } from './queueVerbs';
import type { QueueItem } from './useQueueModel';

export interface LocalOrder {
  /** The queued rows to paint, in order. */
  items: QueueItem[];
  /** Drop moved `fromId` onto `toId`'s slot: paint it, then send it. */
  moveTo: (fromId: string, toId: string) => void;
  /** A wrapped-grid drop: `fromId` lands before or after `targetId`. */
  place: (fromId: string, targetId: string, before: boolean) => void;
  /** ↑ / ↓ from the keyboard alternative. */
  nudge: (id: string, delta: -1 | 1) => void;
  /** framer `Reorder.Group` hands back the whole new id order on every drag frame. */
  setOrder: (ids: string[]) => void;
  /** The drag ended — send whatever is painted. */
  commit: () => void;
}

export function useLocalOrder(
  queued: QueueItem[],
  reorder: (ids: string[]) => Promise<boolean>,
): LocalOrder {
  const [local, setLocal] = useState<QueueItem[] | null>(null);

  // A new model (snapshot or registry change) is the truth again.
  useEffect(() => { setLocal(null); }, [queued]);

  const items = local ?? queued;

  const paint = useCallback(
    (ids: string[]) => {
      const now = Date.now();
      const mean = meanWaitMs(queued, now);
      setLocal(reEstimate(applyOrder(queued, ids), now, mean));
    },
    [queued],
  );

  const send = useCallback(
    (ids: string[]) => {
      paint(ids);
      void reorder(ids).then((ok) => { if (!ok) setLocal(null); });
    },
    [paint, reorder],
  );

  const moveTo = useCallback(
    (fromId: string, toId: string) => {
      const ids = reorderPayload(items, fromId, toId);
      if (ids) send(ids);
    },
    [items, send],
  );

  const place = useCallback(
    (fromId: string, targetId: string, before: boolean) => {
      const ids = dropPayload(items, fromId, targetId, before);
      if (ids) send(ids);
    },
    [items, send],
  );

  const nudge = useCallback(
    (id: string, delta: -1 | 1) => {
      const ids = nudgePayload(items, id, delta);
      if (ids) send(ids);
    },
    [items, send],
  );

  const setOrder = useCallback((ids: string[]) => paint(ids), [paint]);

  const commit = useCallback(() => {
    if (!local) return;
    const ids = local.map((i) => i.sessionId);
    const same = ids.length === queued.length && ids.every((id, i) => queued[i]?.sessionId === id);
    if (!same) void reorder(ids).then((ok) => { if (!ok) setLocal(null); });
  }, [local, queued, reorder]);

  return { items, moveTo, place, nudge, setOrder, commit };
}
