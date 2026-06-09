import { useEffect, useRef, useState } from 'react';
import { terminalPreviews } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';

interface Options {
  /** Poll only while true (e.g. the grid overlay is open). */
  enabled?: boolean;
  /** Poll cadence. Previews are a glance — the focused tile is the live one. */
  intervalMs?: number;
  /** Lines per preview to request. */
  lines?: number;
}

/**
 * Batch-poll cooked terminal previews for the grid's *unwatched* tiles.
 *
 * The watched/active tile mounts a real (subscribed) terminal; every other
 * visible tile renders a cheap text preview cooked from the backend output
 * ring. Polling them in ONE batched IPC call per tick — not one xterm + one
 * live stream per tile — is what keeps a 16-tile grid light: the app's per-tick
 * cost is a single command returning a handful of short lines each, at a low
 * cadence, instead of sixteen realtime VT streams.
 *
 * Returns `sessionId → cooked lines`. Empty list / `enabled: false` → no poll.
 */
export function useFleetTilePreviews(
  sessionIds: string[],
  opts?: Options,
): Map<string, string[]> {
  const enabled = opts?.enabled ?? true;
  const intervalMs = opts?.intervalMs ?? 1200;
  const lines = opts?.lines ?? 24;
  const [previews, setPreviews] = useState<Map<string, string[]>>(new Map());

  // Keep the id list in a ref so the poll interval isn't torn down and rebuilt
  // every render (the array identity changes on every store patch). The tick
  // reads the latest ids at fire time.
  const idsRef = useRef<string[]>(sessionIds);
  idsRef.current = sessionIds;

  // Ring revision last received per session — echoed back as `knownRevs` so
  // the backend omits unchanged sessions (no re-cook, no re-serialize), and
  // the state update is skipped entirely when nothing changed (no re-render).
  const revsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      revsRef.current.clear();
      setPreviews((prev) => (prev.size ? new Map() : prev));
      return;
    }
    let cancelled = false;

    const tick = async () => {
      const ids = idsRef.current;
      if (ids.length === 0) {
        revsRef.current.clear();
        if (!cancelled) setPreviews((prev) => (prev.size ? new Map() : prev));
        return;
      }
      try {
        const knownRevs: Record<string, number> = {};
        for (const id of ids) {
          const rev = revsRef.current.get(id);
          if (rev !== undefined) knownRevs[id] = rev;
        }
        const res = await terminalPreviews(ids, lines, knownRevs);
        if (cancelled) return;
        // An omitted session is unchanged — keep what we have. Prune sessions
        // that left the id list; bail without a state update when nothing did.
        const idSet = new Set(ids);
        for (const key of [...revsRef.current.keys()]) {
          if (!idSet.has(key)) revsRef.current.delete(key);
        }
        for (const p of res) revsRef.current.set(p.sessionId, p.rev);
        setPreviews((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const key of next.keys()) {
            if (!idSet.has(key)) {
              next.delete(key);
              changed = true;
            }
          }
          for (const p of res) {
            next.set(p.sessionId, p.lines);
            changed = true;
          }
          return changed ? next : prev;
        });
      } catch (e) {
        silentCatch('fleet/tilePreviews')(e);
      }
    };

    void tick(); // paint immediately, don't wait a full interval
    const handle = window.setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [enabled, intervalMs, lines]);

  return previews;
}
