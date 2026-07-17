import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
// eslint-disable-next-line no-restricted-imports
import { invoke } from "@tauri-apps/api/core";
import { ConnectorCapabilityNote } from "../tabs/ConnectorCapabilityNote";
import { resetInvokeMocks } from "@/test/tauriMock";

const mockedInvoke = vi.mocked(invoke);

/**
 * The editor's capability note is driven by the backend db_connector_capability
 * classifier (single source of truth), not a frontend hardcode. These tests pin
 * that the note renders the class the backend reports.
 */
describe("ConnectorCapabilityNote", () => {
  beforeEach(() => {
    resetInvokeMocks();
    (globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__IPC_TOKEN;
  });

  it("renders the backend-reported class on the note testid", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "db_connector_capability" ? "select-subset" : undefined,
    );

    render(<ConnectorCapabilityNote serviceType="supabase" />);

    const note = await screen.findByTestId("db-capability-note");
    expect(note).toHaveAttribute("data-capability", "select-subset");
  });

  it("reflects a different class for a key-value connector", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "db_connector_capability" ? "key-value" : undefined,
    );

    render(<ConnectorCapabilityNote serviceType="upstash" />);

    const note = await screen.findByTestId("db-capability-note");
    expect(note).toHaveAttribute("data-capability", "key-value");
  });
});
