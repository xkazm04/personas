import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/overview/events", () => ({
  listEvents: vi.fn(),
}));

import * as eventsApi from "@/api/overview/events";
import { createEventSlice, type EventSlice } from "./eventSlice";
import type { OverviewStore } from "../../storeTypes";
import type { PersonaEvent } from "@/lib/types/types";

function makeEvent(overrides: Partial<PersonaEvent> = {}): PersonaEvent {
  return {
    id: "evt-1",
    project_id: "proj-1",
    event_type: "test.event",
    source_type: "test",
    source_id: null,
    target_persona_id: null,
    payload: null,
    status: "pending",
    error_message: null,
    processed_at: null,
    created_at: "2026-05-05T00:00:00Z",
    use_case_id: null,
    retry_count: 0,
    ...overrides,
  };
}

// Minimal Zustand-style harness — wires set/get around a plain state object so
// each `makeHarness()` call gives a fully isolated slice instance, simulating
// store recreation (HMR reloads, multi-window, test isolation).
function makeHarness() {
  let state = {} as OverviewStore;
  const set = (
    partial:
      | Partial<OverviewStore>
      | ((s: OverviewStore) => Partial<OverviewStore>),
  ) => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createEventSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return {
    get: () => state,
    push: (e: PersonaEvent, max?: number) =>
      (state as EventSlice).pushRecentEvent(e, max),
  };
}

describe("eventSlice — pendingEventCount stays consistent across store recreation", () => {
  it("a fresh slice does not see stale lookups from a previous slice", () => {
    // First slice: receives a pending event for evt-1.
    const first = makeHarness();
    first.push(makeEvent({ id: "evt-1", status: "pending" }));
    expect(first.get().pendingEventCount).toBe(1);
    expect(first.get().recentEvents).toHaveLength(1);

    // Second slice (simulates HMR / multi-window / test isolation): the
    // recentEvents array starts empty. Pushing evt-1 again must treat it as
    // a brand-new entry (delta +1), not as an update of a "prior" event with
    // a stale status. The pre-fix module-scoped Map would have remembered
    // evt-1 across the harness boundary and computed pendingDelta = 0.
    const second = makeHarness();
    expect(second.get().recentEvents).toHaveLength(0);
    expect(second.get().pendingEventCount).toBe(0);

    second.push(makeEvent({ id: "evt-1", status: "pending" }));
    expect(second.get().pendingEventCount).toBe(1);
    expect(second.get().recentEvents).toHaveLength(1);
  });

  it("pushRecentEvent keeps pendingEventCount in lockstep with recentEvents", () => {
    const h = makeHarness();

    h.push(makeEvent({ id: "a", status: "pending" }));
    h.push(makeEvent({ id: "b", status: "pending" }));
    h.push(makeEvent({ id: "c", status: "completed" }));
    expect(h.get().pendingEventCount).toBe(2);

    // Update a pending event to completed → -1
    h.push(makeEvent({ id: "a", status: "completed" }));
    expect(h.get().pendingEventCount).toBe(1);
    expect(
      h.get().recentEvents.filter((e) => e.status === "pending"),
    ).toHaveLength(1);

    // Update a completed event back to pending → +1
    h.push(makeEvent({ id: "c", status: "pending" }));
    expect(h.get().pendingEventCount).toBe(2);

    // Same-status update → 0
    h.push(makeEvent({ id: "b", status: "pending" }));
    expect(h.get().pendingEventCount).toBe(2);
  });

  it("decrements pendingEventCount when a pending event is trimmed off the tail", () => {
    const h = makeHarness();
    const max = 3;

    h.push(makeEvent({ id: "old", status: "pending" }), max);
    h.push(makeEvent({ id: "b", status: "completed" }), max);
    h.push(makeEvent({ id: "c", status: "completed" }), max);
    expect(h.get().pendingEventCount).toBe(1);
    expect(h.get().recentEvents).toHaveLength(3);

    // Push a 4th — "old" (pending) gets trimmed.
    h.push(makeEvent({ id: "d", status: "completed" }), max);
    expect(h.get().recentEvents).toHaveLength(3);
    expect(h.get().recentEvents.find((e) => e.id === "old")).toBeUndefined();
    expect(h.get().pendingEventCount).toBe(0);
  });

  it("fetchRecentEvents resets recentEvents and pendingEventCount together", async () => {
    const h = makeHarness();

    // Seed with stale pending events from a previous lifecycle.
    h.push(makeEvent({ id: "stale-1", status: "pending" }));
    h.push(makeEvent({ id: "stale-2", status: "pending" }));
    expect(h.get().pendingEventCount).toBe(2);

    vi.mocked(eventsApi.listEvents).mockResolvedValueOnce([
      makeEvent({ id: "fresh-1", status: "pending" }),
      makeEvent({ id: "fresh-2", status: "completed" }),
      makeEvent({ id: "fresh-3", status: "completed" }),
    ]);

    await h.get().fetchRecentEvents(50);

    expect(h.get().recentEvents.map((e) => e.id)).toEqual([
      "fresh-1",
      "fresh-2",
      "fresh-3",
    ]);
    expect(h.get().pendingEventCount).toBe(1);

    // Subsequent push for a previously-seen-but-now-trimmed id must be
    // treated as a new event, not as an update.
    h.push(makeEvent({ id: "stale-1", status: "pending" }));
    expect(h.get().pendingEventCount).toBe(2);
    expect(h.get().recentEvents).toHaveLength(4);
  });
});
