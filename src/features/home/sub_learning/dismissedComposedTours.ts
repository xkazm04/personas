import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which outdated Athena-composed tours the user has waved away.
 *
 * The server marks a composed tour `stale` when the anchor manifest drifts,
 * and the card then renders dimmed with no start affordance — correct
 * degradation, but it used to be permanent: the list only ever grew and the
 * user had no way to clear a tour that can never be played again.
 *
 * Deliberately client-side and per-machine (same shape as the sibling
 * `power-moves-progress` store): dismissing is a personal "stop showing me
 * this", not a retirement of the record. The record stays on the server, so
 * a tour that becomes playable again — Athena rebuilds it, or the anchors it
 * needs come back — is shown again by {@link useComposedTours}, which only
 * honours a dismissal while the entry is still unplayable.
 */
interface DismissedComposedToursState {
  /** Composed-tour record ids the user dismissed while they were unplayable. */
  dismissed: Record<string, true>;
  dismiss: (id: string) => void;
  /**
   * Drop ids the server no longer returns. Without this the dismissal set is
   * the same unbounded-growth problem one layer down — it would accumulate an
   * entry for every tour that ever went stale, forever. Returns a NEW state
   * only when something actually changed, so calling it on every load is inert
   * in the steady state.
   */
  prune: (liveIds: readonly string[]) => void;
}

export const useDismissedComposedTours = create<DismissedComposedToursState>()(
  persist(
    (set) => ({
      dismissed: {},
      dismiss: (id) => set((s) => (s.dismissed[id] ? s : { dismissed: { ...s.dismissed, [id]: true } })),
      prune: (liveIds) =>
        set((s) => {
          const live = new Set(liveIds);
          const kept = Object.keys(s.dismissed).filter((id) => live.has(id));
          if (kept.length === Object.keys(s.dismissed).length) return s;
          return { dismissed: Object.fromEntries(kept.map((id) => [id, true as const])) };
        }),
    }),
    { name: 'learning-dismissed-composed-tours', version: 1 },
  ),
);
