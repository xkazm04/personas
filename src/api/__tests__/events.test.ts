import { describe, it, expect, beforeEach } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listEvents,
  listEventsInRange,
  searchEvents,
  listSubscriptions,
  listAllSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  testEventFlow,
  seedMockEvent,
} from "@/api/overview/events";

const _mockedInvoke = vi.mocked(invoke);

describe("api/overview/events", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listEvents calls list_events", async () => {
    mockInvoke("list_events", [{ id: "ev-1" }]);
    const result = await listEvents(10);
    expect(result).toEqual([{ id: "ev-1" }]);
  });

  it("listEventsInRange calls list_events_in_range", async () => {
    mockInvoke("list_events_in_range", { events: [], total: 0 });
    const result = await listEventsInRange("2025-01-01", "2025-01-02", 50);
    expect(result).toEqual({ events: [], total: 0 });
  });

  it("searchEvents calls search_events with filter", async () => {
    mockInvoke("search_events", { events: [], total: 0 });
    const result = await searchEvents({ event_type: "webhook" } as unknown);
    expect(result).toEqual({ events: [], total: 0 });
  });

  it("listSubscriptions returns subscriptions for persona", async () => {
    mockInvoke("list_subscriptions", []);
    expect(await listSubscriptions("p-1")).toEqual([]);
  });

  it("listAllSubscriptions returns all subscriptions", async () => {
    mockInvoke("list_all_subscriptions", [{ id: "sub-1" }]);
    expect(await listAllSubscriptions()).toHaveLength(1);
  });

  it("createSubscription calls create_subscription", async () => {
    const sub = { id: "sub-new" };
    mockInvoke("create_subscription", sub);
    const result = await createSubscription({ event_type: "webhook" } as unknown);
    expect(result).toEqual(sub);
  });

  it("updateSubscription calls update_subscription", async () => {
    mockInvoke("update_subscription", { id: "sub-1" });
    const result = await updateSubscription("sub-1", {} as unknown);
    expect(result).toEqual({ id: "sub-1" });
  });

  it("deleteSubscription returns boolean", async () => {
    mockInvoke("delete_subscription", true);
    expect(await deleteSubscription("sub-1")).toBe(true);
  });

  it("testEventFlow returns event", async () => {
    const event = { id: "ev-test", event_type: "test" };
    mockInvoke("test_event_flow", event);
    const result = await testEventFlow("test", '{"data":1}');
    expect(result).toEqual(event);
  });

  it("seedMockEvent returns event", async () => {
    mockInvoke("seed_mock_event", { id: "ev-mock" });
    expect(await seedMockEvent()).toEqual({ id: "ev-mock" });
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_events", "event store unavailable");
    await expect(listEvents()).rejects.toThrow("event store unavailable");
  });
});
