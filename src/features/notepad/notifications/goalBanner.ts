// The Notepad "goal implemented" title card — the event side.
//
// A souls-like title card laid across the top of the whole app when a note
// moves in_progress → completed (picked 2026-09-15 over a comms-stack bubble).
// A module-level event store, not Zustand: the raiser is `notepadStore`'s
// sweeper path (`refetchNote`) and the host is `GoalBannerHost` at App root,
// and they share nothing but this file. The event carries no display text —
// the host resolves the title against the live translations.

export interface GoalBannerEvent {
  id: string;
  /** The small line under the title — the note's own title, when it has one. */
  subtitle: string | null;
}

const subs = new Set<(e: GoalBannerEvent) => void>();

export function onGoalBanner(cb: (e: GoalBannerEvent) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function emitGoalBanner(subtitle: string | null): void {
  const e: GoalBannerEvent = { id: `goal-banner-${Date.now()}`, subtitle };
  subs.forEach((fn) => fn(e));
}
