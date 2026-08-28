import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ConsoleTab, __resetConsoleHistoryForTests } from "../ConsoleTab";
import { useVaultStore } from "@/stores/vaultStore";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * Query history used to be `useState`, so it died with the component — and the
 * component dies on every switch to the Tables tab. Nothing asserted otherwise,
 * because there was nothing to assert.
 */
const OK_RESULT = { columns: ["ok"], rows: [[1]], row_count: 1, duration_ms: 1 };

beforeEach(() => {
  resetInvokeMocks();
  __resetConsoleHistoryForTests();
  (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "execute_db_query") return OK_RESULT;
    return undefined;
  });
  useVaultStore.setState({ dbSavedQueries: [] });
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
});

async function runQuery(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Run Query/i }));
  });
}

describe("ConsoleTab — query history survives the surface", () => {
  it("still offers the last query after the tab is unmounted and reopened", async () => {
    const first = render(<ConsoleTab credentialId="cred-1" language="sql" />);
    await runQuery("SELECT 1");
    expect(screen.getByTitle("SELECT 1")).toBeInTheDocument();

    // What a switch to Tables and back actually does.
    first.unmount();
    render(<ConsoleTab credentialId="cred-1" language="sql" />);

    expect(screen.getByTitle("SELECT 1")).toBeInTheDocument();
  });

  it("keeps each database's history to itself", async () => {
    const first = render(<ConsoleTab credentialId="cred-1" language="sql" />);
    await runQuery("SELECT 1");
    first.unmount();

    render(<ConsoleTab credentialId="cred-2" language="sql" />);

    expect(screen.queryByTitle("SELECT 1")).not.toBeInTheDocument();
  });
});
