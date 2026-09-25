/** The Glyph approval shows the promote preview above the button row, and a
 *  refusal disables Promote instead of letting the click fail in silence.
 *  scan-sweep challenge-2026-09-23, commands-design B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PromotePreview } from "@/lib/bindings/PromotePreview";

let preview: PromotePreview | null = null;
vi.mock("../usePromotePreview", () => ({ usePromotePreview: () => preview }));
vi.mock("../GlyphCapabilityPreview", () => ({ GlyphCapabilityPreview: () => null }));

import { GlyphTestCompleteCore } from "../GlyphTestCompleteCore";

function renderCore() {
  const onPromote = vi.fn();
  render(
    <GlyphTestCompleteCore
      testPassed
      buildSessionId="s1"
      onPromote={onPromote}
      setRefining={() => {}}
      onShowSimulate={() => {}}
    />,
  );
  return { onPromote };
}

describe("GlyphTestCompleteCore promote preview", () => {
  beforeEach(() => {
    preview = null;
  });

  it("a refusal shows the reason and disables Promote", () => {
    preview = {
      promotable: false,
      refusal: "Polling URL blocked: link-local address",
      setup: null,
      nextFires: [],
    };
    renderCore();
    expect(screen.getByTestId("glyph-promote-refusal").textContent).toContain(
      "Polling URL blocked: link-local address",
    );
    expect((screen.getByTestId("glyph-promote-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a promotable preview lists the arm time and the setup, and Promote stays enabled", () => {
    preview = {
      promotable: true,
      refusal: null,
      setup: {
        blockers: [{ connector: "gmail", kind: "vault_credential", detail: "gmail" }],
        has_autonomous_trigger: true,
        triggers: ["schedule"],
        preview: "",
        notes: [],
      },
      nextFires: [{ triggerType: "schedule", description: "daily", nextFireAt: "2026-09-25T09:00:00Z" }],
    };
    renderCore();
    const panel = screen.getByTestId("glyph-promote-preview");
    expect(panel.textContent).toContain("gmail");
    expect(panel.textContent).toContain("schedule");
    expect((screen.getByTestId("glyph-promote-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("no preview yet renders no panel and never blocks Promote", () => {
    renderCore();
    expect(screen.queryByTestId("glyph-promote-preview")).toBeNull();
    expect(screen.queryByTestId("glyph-promote-refusal")).toBeNull();
    expect((screen.getByTestId("glyph-promote-button") as HTMLButtonElement).disabled).toBe(false);
  });
});
