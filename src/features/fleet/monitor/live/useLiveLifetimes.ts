// Per-message lifetimes for the live pop-up layer.
//
// Every message is stamped with a deadline the first time the host sees it
// live (arrival + LIVE_LIFETIME_MS) — stamped here rather than read off
// `receivedAt`, because external feeds may not set that. One timer is armed for
// the EARLIEST deadline; when it fires, every message already due is handed to
// `expire` together, so overlapping lifetimes simply stack and leave one by one.
//
// HOLD: while the presentation reports the operator is reading (hover / focus),
// no timer runs; on release every deadline shifts by the held span, so a
// message never expires under the pointer and never loses the time it had left.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_LIFETIME_MS, type LiveMessage } from './liveModel';

export function useLiveLifetimes(live: LiveMessage[], expire: (ids: ReadonlySet<string>) => void) {
  const [deadlines, setDeadlines] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [held, setHeld] = useState(false);
  const heldAt = useRef<number | null>(null);

  // Stamp newcomers, forget ids that left the queue (acknowledged / expired).
  useEffect(() => {
    setDeadlines((prev) => {
      const now = Date.now();
      const next = new Map<string, number>();
      let changed = prev.size !== live.length;
      for (const m of live) {
        const d = prev.get(m.id);
        if (d === undefined) changed = true;
        next.set(m.id, d ?? now + LIVE_LIFETIME_MS);
      }
      return changed ? next : prev;
    });
  }, [live]);

  const onHoldChange = useCallback((h: boolean) => {
    if (h) {
      heldAt.current ??= Date.now();
    } else if (heldAt.current !== null) {
      const span = Date.now() - heldAt.current;
      heldAt.current = null;
      setDeadlines((prev) => new Map([...prev].map(([id, d]) => [id, d + span])));
    }
    setHeld(h);
  }, []);

  // Arm one timer for the earliest deadline.
  useEffect(() => {
    if (held || deadlines.size === 0) return;
    const earliest = Math.min(...deadlines.values());
    const timer = setTimeout(() => {
      // A small tolerance so a timer that fires a hair early still collects
      // its own message instead of re-arming for a ~0ms wait.
      const cutoff = Date.now() + 50;
      const due = new Set<string>();
      for (const [id, d] of deadlines) if (d <= cutoff) due.add(id);
      if (due.size > 0) expire(due);
    }, Math.max(0, earliest - Date.now()));
    return () => clearTimeout(timer);
  }, [deadlines, held, expire]);

  return { deadlines, onHoldChange };
}
