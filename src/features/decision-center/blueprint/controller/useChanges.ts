// What changed since the operator last looked, at sheet scope. Each time the scan moves (never the first one: that is
// the baseline), the pure diff in model/changes.ts is run and its entries are announced ONCE:
//   - an entry whose key was announced before is dropped (the seen-set is by event id, so a store that re-delivers the
//     same rows, or a poll, announces nothing; a poll is never a reset);
//   - a status change on an id THIS sheet just sent a write for is the operator's own doing and is not announced;
//   - what is left lands in ONE state update (a burst of changes is one render), marks the changed features on the
//     plan (a one-shot highlight, drawn by the engine) and the changed proposals' queue rows for FLASH_MS.
// Opening the list calls `markSeen`, which clears the chip; the keys stay known, so nothing returns.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanSnapshot } from '@/lib/lensScan/wire';
import type { Engine } from '../engine/Engine';
import { FLASH_MS } from '../engine/changed';
import { diffScan, featureOf, proposalOf, type Change } from '../model/changes';

/** How long a write's ids stay "mine": the store may take a moment to move the status the write asked for. */
export const OWN_TTL_MS = 90_000;

export interface ChangesState {
  /** Announced and not yet opened, newest first. */
  pending: readonly Change[];
  /** Proposal ids whose queue row shows the one-shot highlight right now. */
  fresh: ReadonlySet<string>;
  /** The operator opened the list: the chip clears. */
  markSeen(): void;
  /** A write is about to send these proposal ids: the status changes they cause are not announced. */
  sent(ids: readonly string[]): void;
}

const NONE: ReadonlySet<string> = new Set();

export function useChanges(scan: ScanSnapshot, engine: Pick<Engine, 'flash'> | null): ChangesState {
  const prev = useRef(scan);
  const known = useRef(new Set<string>());
  const mine = useRef(new Map<string, number>());
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const [pending, setPending] = useState<readonly Change[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NONE);

  // the one-shot highlight of the queue rows ends FLASH_MS after the batch that lit it (a newer batch restarts it)
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(NONE), FLASH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  useEffect(() => {
    if (scan === prev.current) return;
    const found = diffScan(prev.current, scan);
    prev.current = scan;
    const now = Date.now();
    const announce = found.filter((c) => {
      if (known.current.has(c.key)) return false;
      if (c.kind === 'status') {
        const at = mine.current.get(c.id);
        if (at !== undefined) {
          mine.current.delete(c.id);
          if (now - at <= OWN_TTL_MS) { known.current.add(c.key); return false; }
        }
      }
      return true;
    });
    if (!announce.length) return;
    for (const c of announce) known.current.add(c.key);
    const fids = new Set<string>(), pids = new Set<string>();
    for (const c of announce) {
      const f = featureOf(c), p = proposalOf(c);
      if (f) fids.add(f);
      if (p) pids.add(p);
    }
    setPending((old) => [...announce, ...old]);
    if (fids.size) engineRef.current?.flash(fids);
    if (pids.size) setFresh(pids);
  }, [scan]);

  const markSeen = useCallback(() => setPending((old) => (old.length ? [] : old)), []);
  const sent = useCallback((ids: readonly string[]) => {
    const now = Date.now();
    for (const id of ids) mine.current.set(id, now);
  }, []);
  return useMemo(() => ({ pending, fresh, markSeen, sent }), [pending, fresh, markSeen, sent]);
}
