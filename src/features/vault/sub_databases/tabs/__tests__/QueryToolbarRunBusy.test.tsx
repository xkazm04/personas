import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryToolbar } from "../QueryToolbar";

vi.mock("../ConnectorCapabilityNote", () => ({
  ConnectorCapabilityNote: () => null,
}));

/**
 * Save and AI-run in this toolbar were already the shared Button, with real
 * spinners and aria-busy. Run/Cancel was a hand-rolled pair swapped whole, so
 * the control the user pressed disappeared and nothing ever carried aria-busy.
 */
const noop = () => {};

function renderToolbar(overrides: Partial<Parameters<typeof QueryToolbar>[0]> = {}) {
  return render(
    <QueryToolbar
      selectedTitle="active users"
      language="sql"
      serviceType="supabase"
      saveState="idle"
      executing={false}
      editorValue="SELECT 1"
      isAiRunning={false}
      safeMode
      onSave={noop}
      onExecute={noop}
      onCancel={noop}
      onAiRun={noop}
      onToggleSafeMode={noop}
      {...overrides}
    />,
  );
}

describe("QueryToolbar — Run/Cancel busy semantics", () => {
  it("Run carries no busy state at rest and is clickable", () => {
    const onExecute = vi.fn();
    renderToolbar({ onExecute });
    // Anchored: "AI Run" sits right beside it and also matches a loose /run/.
    const run = screen.getByRole("button", { name: /^run$/i });
    expect(run.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(run);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("Run stays mounted and sets aria-busy while the query is executing", () => {
    renderToolbar({ executing: true });
    const run = screen.getByRole("button", { name: /running/i });
    expect(run.getAttribute("aria-busy")).toBe("true");
    expect((run as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel appears alongside the busy Run control and still fires", () => {
    const onCancel = vi.fn();
    renderToolbar({ executing: true, onCancel });
    const cancel = screen.getByRole("button", { name: /cancel|abbrechen|annuler/i });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
