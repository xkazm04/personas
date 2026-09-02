import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { PersonaEvent } from "@/lib/types/types";
import { listEvents } from "@/api/overview/events";
import { deduplicateKeyedFetch } from "@/lib/utils/deduplicateFetch";
import { createLogger } from "@/lib/log";

const logger = createLogger("events");

/** Default ceiling on the live window. Matches the value the event-log and
 *  live-stream surfaces pass explicitly, so a caller that omits it lands on
 *  the same bound rather than an unbounded list. */
const MAX_RECENT_EVENTS = 200;

/** Ordering rank for a row. Rows whose `created_at` is absent or unparseable
 *  carry NO server-assigned key (an optimistic client-side emit that was never
 *  persisted — see emitDeploymentEvent). They sort ahead of every keyed row
 *  instead of being ranked against database timestamps by the renderer's clock. */
function rankOf(event: PersonaEvent): number {
  if (!event.created_at) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(event.created_at);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function countPending(events: PersonaEvent[]): number {
  let n = 0;
  for (const e of events) if (e.status === "pending") n += 1;
  return n;
}

/**
 * Merge a freshly-fetched snapshot into the live list instead of replacing it.
 *
 * A wholesale assign discards every event the bus pushed while the request was
 * in flight — the cold-load path fetches TWICE per mount, so that window is
 * real and is exactly when the first live events land. `idsAtRequest` is the id
 * set captured when the request left: an id present locally but absent from it
 * arrived DURING the flight, so the local copy is newer than the snapshot's and
 * wins; for every other id the server row is authoritative.
 */
function mergeSnapshot(
  local: PersonaEvent[],
  snapshot: PersonaEvent[],
  idsAtRequest: ReadonlySet<string>,
  maxItems: number,
): PersonaEvent[] {
  const byId = new Map<string, PersonaEvent>();
  for (const e of snapshot) byId.set(e.id, e);
  for (const e of local) {
    const arrivedDuringFlight = !idsAtRequest.has(e.id);
    if (arrivedDuringFlight || !byId.has(e.id)) byId.set(e.id, e);
  }

  // Newest-first. Stable on ties via the insertion index so a snapshot's own
  // ordering survives when two rows share a timestamp.
  const merged = Array.from(byId.values());
  const order = new Map<string, number>();
  merged.forEach((e, i) => order.set(e.id, i));
  merged.sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) {
      if (ra === Number.POSITIVE_INFINITY) return -1;
      if (rb === Number.POSITIVE_INFINITY) return 1;
      return rb - ra;
    }
    return order.get(a.id)! - order.get(b.id)!;
  });

  return merged.length > maxItems ? merged.slice(0, maxItems) : merged;
}

export interface EventSlice {
  // State
  recentEvents: PersonaEvent[];
  pendingEventCount: number;

  // Actions
  fetchRecentEvents: (limit?: number) => Promise<void>;
  pushRecentEvent: (event: PersonaEvent, maxItems?: number) => void;
  /** Batch form of pushRecentEvent: one index scan and one array copy for the
   *  whole frame's worth of events, instead of one per event. */
  pushRecentEvents: (events: PersonaEvent[], maxItems?: number) => void;
}

export const createEventSlice: StateCreator<OverviewStore, [], [], EventSlice> = (set, get) => ({
  recentEvents: [],
  pendingEventCount: 0,

  fetchRecentEvents: deduplicateKeyedFetch('recentEvents', async (limit?: number) => {
    // Captured BEFORE the await: anything pushed after this point is newer than
    // whatever the snapshot will contain.
    const idsAtRequest = new Set(get().recentEvents.map((e) => e.id));
    try {
      const events = await listEvents(limit ?? 50);
      set((state) => {
        const merged = mergeSnapshot(state.recentEvents, events, idsAtRequest, MAX_RECENT_EVENTS);
        return { recentEvents: merged, pendingEventCount: countPending(merged) };
      });
    } catch (err) {
      logger.warn("fetchRecentEvents failed", { error: String(err) });
    }
  }),

  pushRecentEvent: (event, maxItems = MAX_RECENT_EVENTS) => {
    get().pushRecentEvents([event], maxItems);
  },

  pushRecentEvents: (events, maxItems = MAX_RECENT_EVENTS) => {
    if (events.length === 0) return;
    set((state) => {
      // ONE scan of the existing window to build the id index, ONE copy of the
      // array, regardless of how many events the batch carries. The previous
      // per-event reducer ran a findIndex over up to `maxItems` and allocated a
      // fresh 200-row array for EVERY event, spending the per-frame batching
      // win the singleton listener earns upstream.
      const index = new Map<string, number>();
      state.recentEvents.forEach((e, i) => index.set(e.id, i));

      const updated = state.recentEvents.slice();
      // New ids in arrival order; a repeat within the same batch overwrites in place.
      const fresh: PersonaEvent[] = [];
      const freshIndex = new Map<string, number>();

      for (const event of events) {
        const existing = index.get(event.id);
        if (existing !== undefined) {
          updated[existing] = event;
          continue;
        }
        const pending = freshIndex.get(event.id);
        if (pending !== undefined) {
          fresh[pending] = event;
          continue;
        }
        freshIndex.set(event.id, fresh.length);
        fresh.push(event);
      }

      // Newest last-arrived first, matching the per-event prepend it replaces.
      let nextEvents = fresh.length > 0 ? [...fresh.reverse(), ...updated] : updated;
      if (nextEvents.length > maxItems) nextEvents = nextEvents.slice(0, maxItems);

      return {
        recentEvents: nextEvents,
        // Counted from the array itself rather than carried as a delta: the two
        // can never drift, and the scan is bounded by maxItems.
        pendingEventCount: countPending(nextEvents),
      };
    });
  },
});
