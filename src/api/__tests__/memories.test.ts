import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  listMemories,
  createMemory,
  getMemoryCount,
  getMemoryStats,
  listMemoriesWithStats,
  listMemoriesByExecution,
  deleteMemory,
  updateMemoryImportance,
  batchDeleteMemories,
  reviewMemoriesWithCli,
} from "@/api/overview/memories";

describe("api/overview/memories", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("listMemories returns memories", async () => {
    mockInvoke("list_memories", [{ id: "mem-1" }]);
    expect(await listMemories("p-1", "fact", undefined, 10)).toEqual([{ id: "mem-1" }]);
  });

  it("createMemory returns new memory", async () => {
    mockInvoke("create_memory", { id: "mem-new" });
    expect(await createMemory({ content: "test" } as unknown)).toEqual({ id: "mem-new" });
  });

  it("getMemoryCount returns number", async () => {
    mockInvoke("get_memory_count", 15);
    expect(await getMemoryCount("p-1")).toBe(15);
  });

  it("getMemoryStats returns stats", async () => {
    const stats = { total: 10, avg_importance: 0.7, category_counts: [], agent_counts: [] };
    mockInvoke("get_memory_stats", stats);
    expect(await getMemoryStats()).toEqual(stats);
  });

  it("listMemoriesWithStats returns combined result", async () => {
    const result = {
      memories: [{ id: "mem-1" }],
      total: 1,
      stats: { total: 1, avg_importance: 0.5, category_counts: [], agent_counts: [] },
    };
    mockInvoke("list_memories_with_stats", result);
    expect(await listMemoriesWithStats(undefined, undefined, undefined, 10)).toEqual(result);
  });

  it("listMemoriesByExecution returns memories", async () => {
    mockInvoke("list_memories_by_execution", []);
    expect(await listMemoriesByExecution("e-1")).toEqual([]);
  });

  it("deleteMemory returns boolean", async () => {
    mockInvoke("delete_memory", true);
    expect(await deleteMemory("mem-1")).toBe(true);
  });

  it("updateMemoryImportance returns boolean", async () => {
    mockInvoke("update_memory_importance", true);
    expect(await updateMemoryImportance("mem-1", 4)).toBe(true);
  });

  it("updateMemoryImportance rejects out-of-range values", () => {
    expect(() => updateMemoryImportance("mem-1", 0)).toThrow("Importance must be");
    expect(() => updateMemoryImportance("mem-1", 6)).toThrow("Importance must be");
    expect(() => updateMemoryImportance("mem-1", -1)).toThrow("Importance must be");
    expect(() => updateMemoryImportance("mem-1", 1.5)).toThrow("Importance must be");
  });

  it("createMemory rejects out-of-range importance", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMemory({ persona_id: "p-1", title: "t", content: "c", importance: 0 } as any),
    ).toThrow("Importance must be");
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMemory({ persona_id: "p-1", title: "t", content: "c", importance: 6 } as any),
    ).toThrow("Importance must be");
  });

  it("batchDeleteMemories returns count", async () => {
    mockInvoke("batch_delete_memories", 3);
    expect(await batchDeleteMemories(["mem-1", "mem-2", "mem-3"])).toBe(3);
  });

  it("reviewMemoriesWithCli returns review result", async () => {
    const result = { reviewed: 10, deleted: 2, updated: 3, details: [] };
    mockInvoke("review_memories_with_cli", result);
    expect(await reviewMemoriesWithCli("p-1", 0.3)).toEqual(result);
  });

  it("rejects on backend error", async () => {
    mockInvokeError("list_memories", "storage full");
    await expect(listMemories()).rejects.toThrow("storage full");
  });
});
