import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listMessages,
  getMessage,
  markMessageRead,
  markAllMessagesRead,
  deleteMessage,
  getUnreadMessageCount,
  getMessageCount,
  getMessageDeliveries,
  getBulkDeliverySummaries,
  seedMockMessage,
} from "@/api/overview/messages";

describe("api/overview/messages", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listMessages returns messages", async () => {
    mockInvoke("list_messages", [{ id: "m-1" }]);
    expect(await listMessages(10, 0)).toEqual([{ id: "m-1" }]);
  });

  it("getMessage returns single message", async () => {
    mockInvoke("get_message", { id: "m-1", body: "hello" });
    expect(await getMessage("m-1")).toEqual({ id: "m-1", body: "hello" });
  });

  it("markMessageRead resolves", async () => {
    mockInvoke("mark_message_read", undefined);
    await expect(markMessageRead("m-1")).resolves.toBeUndefined();
  });

  it("markAllMessagesRead resolves", async () => {
    mockInvoke("mark_all_messages_read", undefined);
    await expect(markAllMessagesRead("p-1")).resolves.toBeUndefined();
  });

  it("deleteMessage returns boolean", async () => {
    mockInvoke("delete_message", true);
    expect(await deleteMessage("m-1")).toBe(true);
  });

  it("getUnreadMessageCount returns number", async () => {
    mockInvoke("get_unread_message_count", 5);
    expect(await getUnreadMessageCount()).toBe(5);
  });

  it("getMessageCount returns number", async () => {
    mockInvoke("get_message_count", 42);
    expect(await getMessageCount()).toBe(42);
  });

  it("getMessageDeliveries returns deliveries", async () => {
    mockInvoke("get_message_deliveries", []);
    expect(await getMessageDeliveries("m-1")).toEqual([]);
  });

  it("getBulkDeliverySummaries returns summaries", async () => {
    mockInvoke("get_bulk_delivery_summaries", [{ messageId: "m-1", delivered: 1, pending: 0, failed: 0 }]);
    const result = await getBulkDeliverySummaries(["m-1"]);
    expect(result).toHaveLength(1);
  });

  it("seedMockMessage returns message", async () => {
    mockInvoke("seed_mock_message", { id: "m-mock" });
    expect(await seedMockMessage()).toEqual({ id: "m-mock" });
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_messages", "timeout");
    await expect(listMessages()).rejects.toThrow("timeout");
  });
});
