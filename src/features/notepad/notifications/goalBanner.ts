// PROTOTYPE 2026-09-15 — variant B of the Notepad state-change notice.
//
// A souls-like title card ("GOAL IMPLEMENTED") laid across the top of the whole
// app when a note moves in_progress → completed. A module-level event store,
// not Zustand, so the host at App root and whatever raises it (today: the
// temporary button in NoteOverview's header; later: the real status
// transition) share nothing but this file. Remove with GoalBannerHost if the
// comms-stack variant (A) wins.

export interface GoalBannerEvent {
  id: string;
  /** The big line. */
  title: string;
  /** The small line under it — the note's own title. */
  subtitle: string | null;
}

const subs = new Set<(e: GoalBannerEvent) => void>();

export function onGoalBanner(cb: (e: GoalBannerEvent) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function emitGoalBanner(title: string, subtitle: string | null): void {
  const e: GoalBannerEvent = { id: `goal-banner-${Date.now()}`, title, subtitle };
  subs.forEach((fn) => fn(e));
}
