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

  it("fetchRecentEvents keeps pendingEventCount in lockstep with the merged list", async () => {
    const h = makeHarness();

    // Seed with events from a previous lifecycle. They were present BEFORE the
    // fetch left, so the snapshot is authoritative for the ids it carries.
    h.push(makeEvent({ id: "known-1", status: "pending", created_at: "2026-05-05T00:00:01Z" }));
    h.push(makeEvent({ id: "known-2", status: "pending", created_at: "2026-05-05T00:00:02Z" }));
    expect(h.get().pendingEventCount).toBe(2);

    vi.mocked(eventsApi.listEvents).mockResolvedValueOnce([
      makeEvent({ id: "fresh-1", status: "pending", created_at: "2026-05-05T00:00:05Z" }),
      makeEvent({ id: "known-2", status: "completed", created_at: "2026-05-05T00:00:02Z" }),
      makeEvent({ id: "fresh-3", status: "completed", created_at: "2026-05-05T00:00:00Z" }),
    ]);

    await h.get().fetchRecentEvents(50);

    // Newest-first, and the server's status for known-2 wins over the local one.
    expect(h.get().recentEvents.map((e) => e.id)).toEqual([
      "fresh-1",
      "known-2",
      "known-1",
      "fresh-3",
    ]);
    expect(h.get().pendingEventCount).toBe(2); // fresh-1 + known-1
  });

  it("an event pushed while the snapshot request is in flight survives the snapshot", async () => {
    const h = makeHarness();

    let resolveFetch!: (rows: PersonaEvent[]) => void;
    vi.mocked(eventsApi.listEvents).mockImplementationOnce(
      () => new Promise<PersonaEvent[]>((resolve) => { resolveFetch = resolve; }),
    );

    const inFlight = h.get().fetchRecentEvents(10);

    // The bus pushes a live event while the request is still open. Before the
    // merge fix, the wholesale `set({ recentEvents: events })` below dropped it.
    h.push(makeEvent({ id: "live-during-flight", status: "pending", created_at: "2026-05-05T00:00:09Z" }));

    resolveFetch([
      makeEvent({ id: "snap-1", status: "completed", created_at: "2026-05-05T00:00:03Z" }),
      makeEvent({ id: "snap-2", status: "completed", created_at: "2026-05-05T00:00:02Z" }),
    ]);
    await inFlight;

    expect(h.get().recentEvents.map((e) => e.id)).toEqual([
      "live-during-flight",
      "snap-1",
      "snap-2",
    ]);
    expect(h.get().pendingEventCount).toBe(1);
  });

  it("a status update pushed during the flight is not clobbered by the older snapshot row", async () => {
    const h = makeHarness();

    let resolveFetch!: (rows: PersonaEvent[]) => void;
    vi.mocked(eventsApi.listEvents).mockImplementationOnce(
      () => new Promise<PersonaEvent[]>((resolve) => { resolveFetch = resolve; }),
    );

    const inFlight = h.get().fetchRecentEvents(10);
    h.push(makeEvent({ id: "evt-x", status: "completed", created_at: "2026-05-05T00:00:04Z" }));

    // The snapshot was read before evt-x completed, so it still says pending.
    resolveFetch([makeEvent({ id: "evt-x", status: "pending", created_at: "2026-05-05T00:00:04Z" })]);
    await inFlight;

    expect(h.get().recentEvents).toHaveLength(1);
    expect(h.get().recentEvents[0]!.status).toBe("completed");
    expect(h.get().pendingEventCount).toBe(0);
  });

  it("the merged list respects the 200-row cap", async () => {
    const h = makeHarness();
    for (let i = 0; i < 150; i++) {
      h.push(makeEvent({ id: `local-${i}`, status: "completed", created_at: `2026-05-05T00:00:${String(i % 60).padStart(2, "0")}Z` }));
    }
    vi.mocked(eventsApi.listEvents).mockResolvedValueOnce(
      Array.from({ length: 150 }, (_, i) => makeEvent({ id: `snap-${i}`, status: "completed", created_at: "2026-05-06T00:00:00Z" })),
    );
    await h.get().fetchRecentEvents(150);
    expect(h.get().recentEvents).toHaveLength(200);
  });
});

describe("eventSlice - pushRecentEvents (batch)", () => {
  it("matches the per-event push for order, dedupe and pending count", () => {
    const perEvent = makeHarness();
    const batched = makeHarness();

    const batch = [
      makeEvent({ id: "a", status: "pending" }),
      makeEvent({ id: "b", status: "completed" }),
      makeEvent({ id: "c", status: "pending" }),
      makeEvent({ id: "a", status: "completed" }), // status update inside the batch
    ];

    for (const e of batch) perEvent.push(e);
    (batched.get() as EventSlice).pushRecentEvents(batch);

    expect(batched.get().recentEvents.map((e) => e.id)).toEqual(
      perEvent.get().recentEvents.map((e) => e.id),
    );
    expect(batched.get().recentEvents.map((e) => e.status)).toEqual(
      perEvent.get().recentEvents.map((e) => e.status),
    );
    expect(batched.get().pendingEventCount).toBe(perEvent.get().pendingEventCount);
  });

  it("updates an already-present event in place and respects the cap", () => {
    const h = makeHarness();
    h.push(makeEvent({ id: "old", status: "pending" }), 3);
    (h.get() as EventSlice).pushRecentEvents(
      [
        makeEvent({ id: "old", status: "completed" }),
        makeEvent({ id: "n1", status: "completed" }),
        makeEvent({ id: "n2", status: "completed" }),
        makeEvent({ id: "n3", status: "pending" }),
      ],
      3,
    );
    expect(h.get().recentEvents.map((e) => e.id)).toEqual(["n3", "n2", "n1"]);
    expect(h.get().pendingEventCount).toBe(1);
  });

  it("an empty batch is a no-op", () => {
    const h = makeHarness();
    h.push(makeEvent({ id: "a", status: "pending" }));
    const before = h.get().recentEvents;
    (h.get() as EventSlice).pushRecentEvents([]);
    expect(h.get().recentEvents).toBe(before);
  });
});
