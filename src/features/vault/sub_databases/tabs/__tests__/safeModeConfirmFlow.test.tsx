import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ConsoleTab } from "../ConsoleTab";
import { QueryEditorPane } from "../QueryEditorPane";
import { useVaultStore } from "@/stores/vaultStore";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * The safe-mode confirm gate on the two surfaces where a HUMAN types the
 * destructive statement. The chat suite covers the AI lane; ConsoleTab and
 * QueryEditorPane each instantiate `useQuerySafeMode` independently and neither
 * was covered, so nothing asserted that a typed DELETE is held back, that the
 * banner quotes the statement, or that confirming is what flips allowMutation.
 */
const OK_RESULT = { columns: ["ok"], rows: [[1]], row_count: 1, duration_ms: 1 };

function executeCalls() {
  return mockedInvoke.mock.calls.filter((c) => c[0] === "execute_db_query");
}

function lastExecuteArgs() {
  const calls = executeCalls();
  return calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  resetInvokeMocks();
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

describe("ConsoleTab — safe-mode confirm gate", () => {
  async function typeAndRun(text: string) {
    render(<ConsoleTab credentialId="cred-1" language="sql" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Query/i }));
    });
  }

  it("holds a typed DELETE behind the confirm banner instead of dispatching it", async () => {
    await typeAndRun("DELETE FROM users WHERE id = 1");

    expect(screen.getByTestId("db-mutation-confirm")).toBeInTheDocument();
    // The banner must quote the statement the user is being asked to authorise.
    expect(
      within(screen.getByTestId("db-mutation-confirm")).getByText("DELETE FROM users WHERE id = 1"),
    ).toBeInTheDocument();
    expect(executeCalls()).toHaveLength(0);
  });

  it("dispatches with allowMutation true only after the user confirms", async () => {
    await typeAndRun("DELETE FROM users WHERE id = 1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-run"));
    });

    expect(executeCalls()).toHaveLength(1);
    expect(lastExecuteArgs()).toMatchObject({
      queryText: "DELETE FROM users WHERE id = 1",
      allowMutation: true,
    });
    expect(screen.queryByTestId("db-mutation-confirm")).not.toBeInTheDocument();
  });

  it("cancelling the banner runs nothing at all", async () => {
    await typeAndRun("DELETE FROM users WHERE id = 1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-cancel"));
    });

    expect(executeCalls()).toHaveLength(0);
    expect(screen.queryByTestId("db-mutation-confirm")).not.toBeInTheDocument();
  });

  it("runs a read straight through with allowMutation false", async () => {
    await typeAndRun("SELECT * FROM users");

    expect(screen.queryByTestId("db-mutation-confirm")).not.toBeInTheDocument();
    expect(executeCalls()).toHaveLength(1);
    expect(lastExecuteArgs()).toMatchObject({
      queryText: "SELECT * FROM users",
      allowMutation: false,
    });
  });
});

describe("QueryEditorPane — safe-mode confirm gate", () => {
  function renderPane(editorValue: string) {
    render(
      <QueryEditorPane
        credentialId="cred-1"
        language="sql"
        serviceType="supabase"
        selectedId="q-1"
        selectedTitle="List users"
        editorValue={editorValue}
        onEditorChange={() => {}}
      />,
    );
  }

  async function clickRun() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));
    });
  }

  it("holds a typed UPDATE behind the confirm banner", async () => {
    renderPane("UPDATE users SET name = 'x'");
    await clickRun();

    expect(screen.getByTestId("db-mutation-confirm")).toBeInTheDocument();
    expect(executeCalls()).toHaveLength(0);
  });

  it("dispatches with allowMutation true only after the user confirms", async () => {
    renderPane("UPDATE users SET name = 'x'");
    await clickRun();

    await act(async () => {
      fireEvent.click(screen.getByTestId("db-mutation-confirm-run"));
    });

    expect(executeCalls()).toHaveLength(1);
    expect(lastExecuteArgs()).toMatchObject({
      queryText: "UPDATE users SET name = 'x'",
      allowMutation: true,
    });
  });

  it("runs a read straight through with allowMutation false", async () => {
    renderPane("SELECT 1");
    await clickRun();

    expect(screen.queryByTestId("db-mutation-confirm")).not.toBeInTheDocument();
    expect(lastExecuteArgs()).toMatchObject({ allowMutation: false });
  });
});
