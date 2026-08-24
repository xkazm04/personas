import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listReports,
  getReport,
  markReportRead,
  markAllReportsRead,
  deleteReport,
  getUnreadReportCount,
  getReportCount,
  getReportDeliveries,
  getBulkDeliverySummaries,
  seedMockMessage,
} from "@/api/overview/reports";

describe("api/overview/reports", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listReports returns messages", async () => {
    mockInvoke("list_reports", [{ id: "m-1" }]);
    expect(await listReports(10, 0)).toEqual([{ id: "m-1" }]);
  });

  it("getReport returns single message", async () => {
    mockInvoke("get_report", { id: "m-1", body: "hello" });
    expect(await getReport("m-1")).toEqual({ id: "m-1", body: "hello" });
  });

  it("markReportRead resolves", async () => {
    mockInvoke("mark_report_read", undefined);
    await expect(markReportRead("m-1")).resolves.toBeUndefined();
  });

  it("markAllReportsRead resolves", async () => {
    mockInvoke("mark_all_reports_read", undefined);
    await expect(markAllReportsRead("p-1")).resolves.toBeUndefined();
  });

  it("deleteReport returns boolean", async () => {
    mockInvoke("delete_report", true);
    expect(await deleteReport("m-1")).toBe(true);
  });

  it("getUnreadReportCount returns number", async () => {
    mockInvoke("get_unread_report_count", 5);
    expect(await getUnreadReportCount()).toBe(5);
  });

  it("getReportCount returns number", async () => {
    mockInvoke("get_report_count", 42);
    expect(await getReportCount()).toBe(42);
  });

  it("getReportDeliveries returns deliveries", async () => {
    mockInvoke("get_report_deliveries", []);
    expect(await getReportDeliveries("m-1")).toEqual([]);
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
    mockInvokeError("list_reports", "timeout");
    await expect(listReports()).rejects.toThrow("timeout");
  });
});
