/** useSheetClock — the honest build clock behind the action panel and the
 *  film rail, read from the per-session ledger in `centre/buildClock.ts`.
 *
 *  It counts only while the machine works (building or screening) and stands
 *  still in every state that waits for the user. The ledger lives outside
 *  React and follows the store, so a remount, a re-opened draft or a session
 *  switch picks the count up where it really is. The panel and the rail read
 *  this one hook, so they always agree. */
import { useEffect, useState } from "react";
import { useModuleSubscription } from "@/hooks/utility/data/useModuleSubscription";
import { CLOCK, ensureClockTracking, entryElapsed, type ClockKind, type ClockMark } from "./centre/buildClock";

export type { ClockKind, ClockMark };

export function useSheetClock(sessionId: string | null) {
  useEffect(() => { ensureClockTracking(); }, []);
  const entry = useModuleSubscription(CLOCK, sessionId ?? "");
  const open = entry?.open ?? null;
  const since = entry?.since ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, since]);

  return {
    elapsed: sessionId ? entryElapsed(entry, now) : 0,
    marks: entry?.marks ?? [],
    /** What the machine is doing now; null while it waits on you. */
    running: open,
    /** Seen first while waiting: time before that is unknown. */
    partial: entry?.partial ?? false,
  };
}

export type SheetClock = ReturnType<typeof useSheetClock>;

/** Whose time was second `t`? */
export function kindAt(marks: ClockMark[], t: number): ClockKind | null {
  let k: ClockKind | null = null;
  for (const m of marks) {
    if (m.at <= t) k = m.kind;
    else break;
  }
  return k;
}
