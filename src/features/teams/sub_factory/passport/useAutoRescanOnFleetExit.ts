// R22 — close the dispatch loop. A `passport:*` Fleet session exiting is the
// signal that an agent just finished working a wall surface (R19 unified rows,
// onboard, ship criteria). The deterministic verifier already exists — the
// scoped passport rescan — so run it automatically: watch the store's fleet
// sessions for exit transitions (state → 'exited', or removal while live) and
// re-aggregate the affected project. Without this, the row's gear simply
// returns when the session dies and the wall keeps showing pre-dispatch state
// until someone rescans by hand.
//
// Mounted by the Factory wall host (ProjectsLayer) and the Mastermind canvas;
// exits are deduped by session id at MODULE scope so simultaneous mounts
// (e.g. the Skills modal over the wall) never rescan the same exit twice.
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';

/** Every passport dispatch key ends in the project id — `passport:<row>:<slug>`,
 *  `passport:onboard:<slug>`, `passport:ship-<criterion>:<projectId>` — and
 *  `identity.slug` IS `meta.project_id` (passportDerive.ts). Returns null for
 *  non-passport session names. */
export function projectIdFromDispatchKey(name: string | null | undefined): string | null {
  if (!name || !name.startsWith('passport:')) return null;
  const parts = name.split(':');
  if (parts.length < 3) return null;
  const pid = parts[parts.length - 1];
  return pid ? pid : null;
}

/** Session ids whose exit already triggered a rescan — survives remounts so a
 *  navigate-away-and-back (or a second mounted surface) can't double-fire. */
const handledExits = new Set<string>();

/** Settle delay between the exit event and the rescan, so the exiting CLI's
 *  final writes (commits, generated files) land on disk before the scan reads. */
const SETTLE_MS = 1500;

export function useAutoRescanOnFleetExit(rescanProject: (projectId: string) => Promise<unknown>): void {
  const fleetSessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const fleetStartSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  // Per-mount baseline of passport-keyed sessions. Seeded on the first sample —
  // sessions already exited at mount are history, not "just finished".
  const prevRef = useRef<Map<string, { name: string | null; state: string }> | null>(null);
  const queueRef = useRef<{ queue: string[]; draining: boolean }>({ queue: [], draining: false });
  const rescanRef = useRef(rescanProject);
  rescanRef.current = rescanProject;

  // The store's fleet listeners are idempotent (once per process) — attach so
  // exits reach us even when the Fleet grid was never opened this session.
  useEffect(() => {
    fleetStartSessionListeners();
  }, [fleetStartSessionListeners]);

  useEffect(() => {
    const next = new Map<string, { name: string | null; state: string }>();
    for (const s of fleetSessions) {
      if (projectIdFromDispatchKey(s.name)) next.set(s.id, { name: s.name ?? null, state: s.state });
    }
    const prev = prevRef.current;
    prevRef.current = next;
    if (!prev) return;

    const finished = new Map<string, string>(); // session id → project id
    for (const [id, cur] of next) {
      const was = prev.get(id);
      if (was && was.state !== 'exited' && cur.state === 'exited') {
        const pid = projectIdFromDispatchKey(cur.name);
        if (pid) finished.set(id, pid);
      }
    }
    // The registry may drop a session instead of flipping it to exited.
    for (const [id, was] of prev) {
      if (!next.has(id) && was.state !== 'exited') {
        const pid = projectIdFromDispatchKey(was.name);
        if (pid) finished.set(id, pid);
      }
    }

    const q = queueRef.current;
    for (const [id, pid] of finished) {
      if (handledExits.has(id)) continue;
      handledExits.add(id);
      if (!q.queue.includes(pid)) q.queue.push(pid);
    }
    if (q.queue.length === 0 || q.draining) return;
    // Drain sequentially — scoped rescans re-derive the whole wall on publish,
    // and usePassportData's latest-wins token would drop overlapping builds.
    q.draining = true;
    void (async () => {
      while (q.queue.length > 0) {
        const pid = q.queue.shift()!;
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        await rescanRef.current(pid).catch(silentCatch('useAutoRescanOnFleetExit:rescan'));
      }
      q.draining = false;
    })();
  }, [fleetSessions]);
}
