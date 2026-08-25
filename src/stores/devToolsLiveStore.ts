import { create } from 'zustand';

import { cdcDroppedCount } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Live-refresh signal for the dev-tools Ship slice.
 *
 * The Ship planner is a surface the operator WATCHES while work happens
 * somewhere else — background agents, an Athena approval executor, a Fleet
 * session through the management API, the CLI ingest door. None of those
 * writers know the planner exists, so the tab's own `reload()` after its own
 * mutations was never going to cover them.
 *
 * The push side is `EventName.DEV_TOOLS_SHIP_CHANGED`, emitted by the SQLite
 * `update_hook` in `db/src/cdc.rs` for a write to any of the four Ship tables.
 * `eventBridge` debounces it and calls {@link markShipChanged}; anything
 * subscribed to `shipRevision` refetches.
 *
 * **That push is lossy by construction**, which is what {@link reconcileShip}
 * is for — see its doc. There is deliberately NO timer anywhere in this file:
 * polling was ruled out, and a watermark query loop is a poll with extra steps.
 */
interface DevToolsLiveState {
  /**
   * Monotonic counter. Bumped once per (debounced) burst of Ship-table writes
   * that happened outside the current tab, and once per reconcile that found
   * evidence of a dropped push. Subscribers treat any change as "refetch".
   */
  shipRevision: number;
  /**
   * CDC drop count observed at the last reconcile, or `null` before the first
   * one. `null` is meaningfully different from `0`: the first reading is a
   * BASELINE (drops may predate this session's interest in the slice and the
   * subscriber has just fetched anyway), so it must not itself trigger a
   * refetch.
   */
  lastSeenCdcDrops: number | null;
  /** Guard so a focus + visibilitychange pair does not fire two reads. */
  reconciling: boolean;
  /** Push path: a Ship-table write landed. Called from `eventBridge`. */
  markShipChanged: () => void;
  /**
   * Reconcile on EVIDENCE, not on a clock.
   *
   * `db/src/cdc.rs` pushes through a bounded channel and DROPS events when the
   * drain falls behind the write rate — `note_cdc_drop`'s own comment says the
   * frontend "may miss a live update for this table until its next
   * poll/refetch". So a pure-push design is lossy by construction, and a
   * listener that only ever reacts to pushes cannot tell it is stale.
   *
   * `cdc_dropped_count` is the process-wide drop counter. Reading it on window
   * focus / `visibilitychange → visible` / route entry and refetching only when
   * the number MOVED costs one IPC returning an integer, and costs nothing at
   * all in the overwhelming case where nothing was dropped.
   */
  reconcileShip: () => Promise<void>;
}

export const useDevToolsLiveStore = create<DevToolsLiveState>((set, get) => ({
  shipRevision: 0,
  lastSeenCdcDrops: null,
  reconciling: false,

  markShipChanged: () => set((s) => ({ shipRevision: s.shipRevision + 1 })),

  reconcileShip: async () => {
    if (get().reconciling) return;
    set({ reconciling: true });
    try {
      const dropped = await cdcDroppedCount();
      const seen = get().lastSeenCdcDrops;
      if (seen === null) {
        // Baseline only — see `lastSeenCdcDrops`.
        set({ lastSeenCdcDrops: dropped });
        return;
      }
      if (dropped !== seen) {
        // The counter is monotonic, so any change means at least one push was
        // lost. We cannot know WHICH table lost it, which is exactly why the
        // answer is "refetch the slice" rather than a targeted repair.
        set((s) => ({ lastSeenCdcDrops: dropped, shipRevision: s.shipRevision + 1 }));
      }
    } catch (e) {
      // A failed reconcile leaves `lastSeenCdcDrops` untouched, so the next
      // one re-compares against the same baseline and nothing is missed.
      silentCatch('devToolsLive:reconcile')(e);
    } finally {
      set({ reconciling: false });
    }
  },
}));
