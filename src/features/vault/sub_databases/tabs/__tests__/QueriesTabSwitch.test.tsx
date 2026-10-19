import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { QueriesTab } from "../QueriesTab";
import { useVaultStore } from "@/stores/vaultStore";
import { resetInvokeMocks } from "@/test/tauriMock";
import type { DbSavedQuery } from "@/lib/bindings/DbSavedQuery";

const mockedInvoke = vi.mocked(invoke);

/**
 * The editor pane owns one saved query's run state. Switching to another saved
 * query used to keep the previous query's result grid under the new title.
 */
function saved(id: string, title: string, text: string): DbSavedQuery {
  return {
    id, credential_id: "cred-1", title, query_text: text, language: "sql",
    last_run_at: null, last_run_ok: null, last_run_ms: null, is_favorite: false,
    sort_order: 0, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z",
  };
}

beforeEach(() => {
  resetInvokeMocks();
  (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "execute_db_query") {
      return { columns: ["only_in_a"], rows: [["row-from-a"]], row_count: 1, duration_ms: 1 };
    }
    return undefined;
  });
  useVaultStore.setState({
    dbSavedQueries: [saved("q-a", "Query A", "SELECT 'a'"), saved("q-b", "Query B", "SELECT 'b'")],
  });
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
});

describe("QueriesTab — switching saved query", () => {
  it("does not carry the previous query's result into the next one", async () => {
    render(<QueriesTab credentialId="cred-1" language="sql" serviceType="supabase" />);

    fireEvent.click(screen.getByText("Query A"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));
    });
    expect(screen.getByText("row-from-a")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Query B"));
    // Query B has never run: its pane must not show A's rows.
    expect(screen.getAllByText("Query B").length).toBeGreaterThan(0);
    expect(screen.queryByText("row-from-a")).not.toBeInTheDocument();
  });
});
