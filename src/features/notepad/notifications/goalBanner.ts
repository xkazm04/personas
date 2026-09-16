// The Notepad ceremony title card — the event side.
//
// A souls-like title card laid across the top of the whole app when a note
// crosses one of the three moments worth marking (picked 2026-09-15 over a
// comms-stack bubble). A module-level event store, not Zustand: the raiser is
// `notepadStore`'s sweeper path (`refetchNote`) and the host is `GoalBannerHost`
// at App root, and they share nothing but this file. The event carries no
// display text — the host resolves the headline against the live translations
// from `kind`, which is why `kind` and not a string is what travels.

/**
 * WHICH moment this is. One per transition the pad marks:
 *  - `goal`    — a brainstorm note's run came back: `in_progress → completed`
 *  - `cut`     — a plan note's scope was frozen:    `scoped → cut`
 *  - `shipped` — the milestone landed:              `cut → shipped`
 *
 * The two rails each get their close, and the pad says so in the same grammar.
 */
export type GoalBannerKind = 'goal' | 'cut' | 'shipped';

export interface GoalBannerEvent {
  id: string;
  kind: GoalBannerKind;
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

/** `kind` defaults to `goal` so the original single-moment call site — and any
 *  test written against it — keeps meaning exactly what it meant. */
export function emitGoalBanner(subtitle: string | null, kind: GoalBannerKind = 'goal'): void {
  const e: GoalBannerEvent = { id: `goal-banner-${Date.now()}-${kind}`, kind, subtitle };
  subs.forEach((fn) => fn(e));
}
