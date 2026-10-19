import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useVaultStore } from "@/stores/vaultStore";
import type { QueryResult } from "@/api/vault/database/dbSchema";

/**
 * Each Redis key click fires its own `TYPE <key>` lookup, and the replies come
 * back in whatever order the server answers. Selecting key A and then key B,
 * with A's reply landing last, used to paint A's type under B's header.
 */
vi.mock("@/hooks/database/useTableIntrospection", () => ({
  getCachedColumns: () => null,
  useTableIntrospection: () => ({
    tables: [],
    redisKeys: [{ key: "user:1" }, { key: "queue:jobs" }],
    loading: false,
    error: null,
    isRedis: true,
    family: "redis",
    fetchTables: vi.fn(),
    fetchMoreTables: vi.fn(),
    truncated: false,
    fetchColumns: vi.fn(),
    columns: [],
    columnsLoading: false,
    columnsError: null,
    clearCache: vi.fn(),
  }),
}));

import { TablesTab } from "../TablesTab";

type ExecuteDbQuery = ReturnType<typeof useVaultStore.getState>["executeDbQuery"];

function typeResult(type: string): QueryResult {
  const result: QueryResult = { columns: ["type"], rows: [[type]], row_count: 1, duration_ms: 1, truncated: false };
  return result;
}

describe("Redis key TYPE lookup — the latest click wins", () => {
  const pending = new Map<string, (r: QueryResult) => void>();

  beforeEach(() => {
    pending.clear();
    useVaultStore.setState({
      dbSchemaTables: [],
      executeDbQuery: vi.fn<ExecuteDbQuery>((_cred, text) =>
        new Promise<QueryResult>((resolve) => { pending.set(text, resolve); }),
      ),
    });
  });

  it("does not paint the earlier key's type under the later key", async () => {
    render(<TablesTab credentialId="cred-1" serviceType="redis" />);

    fireEvent.click(screen.getByText("user:1"));
    fireEvent.click(screen.getByText("queue:jobs"));

    // The later lookup answers first, then the earlier one straggles in.
    await act(async () => { pending.get('TYPE "queue:jobs"')!(typeResult("list")); });
    await act(async () => { pending.get('TYPE "user:1"')!(typeResult("hash")); });

    expect(screen.getByTestId("db-redis-key-type").textContent).toBe("list");
  });
});
