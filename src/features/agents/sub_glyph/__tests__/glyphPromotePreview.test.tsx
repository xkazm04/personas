/** The verdict act of Sheet · Cinema shows the promote preview above its
 *  actions, and a refusal disables Promote (and Promote anyway) instead of
 *  letting the click fail in silence. Retargeted from the retired
 *  GlyphTestCompleteCore (scan-sweep challenge-2026-09-23, commands-design B,
 *  b6a4e1e304) to the sheet's centre action panel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PromotePreview } from "@/lib/bindings/PromotePreview";
import type { GlyphFullLayoutProps } from "../glyphLayoutTypes";
import type { SheetState } from "../contactSheet/cinema/useSheetState";
import type { CentreActions } from "../contactSheet/cinema/centre/ActPanel";

let preview: PromotePreview | null = null;
vi.mock("../usePromotePreview", () => ({ usePromotePreview: () => preview }));

import { ActPanel } from "../contactSheet/cinema/centre/ActPanel";

const noop = () => {};
const actions: CentreActions = {
  openContext: noop, openCore: noop, openRefine: noop, openCaps: noop, openReport: noop,
  openSimulate: noop, openLog: noop, askForce: noop, askReject: noop, startOver: noop,
};

function renderVerdict(passed: boolean) {
  const onPromote = vi.fn();
  // Test fixture: the verdict branch of ActPanel reads only these fields of the
  // layout props and the sheet state; the full shapes carry live hooks' output.
  const p = {
    buildPhase: "test_complete", testPassed: passed, testError: passed ? null : "a tool failed",
    toolTestResults: [], onPromote, onPromoteForce: noop, onRejectTest: noop, onRefine: noop,
    cliOutputLines: [],
  } as unknown as GlyphFullLayoutProps;
  const s = {
    act: "verdict", sessionId: "s1", flow: {}, cast: {},
    clock: { elapsed: 0, running: null, partial: false },
  } as unknown as SheetState;
  render(<ActPanel p={p} s={s} a={actions} tight={false} />);
  return { onPromote };
}

/** The preview sits in the panel body, which precedes the actions row. */
function precedes(a: Element, b: Element) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("Sheet verdict promote preview", () => {
  beforeEach(() => {
    preview = null;
  });

  it("a refusal shows the reason above the actions and disables Promote", () => {
    preview = {
      promotable: false,
      refusal: "Polling URL blocked: link-local address",
      setup: null,
      nextFires: [],
    };
    renderVerdict(true);
    const refusal = screen.getByTestId("glyph-promote-refusal");
    expect(refusal.textContent).toContain("Polling URL blocked: link-local address");
    const button = screen.getByTestId("glyph-promote-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(precedes(refusal, button)).toBe(true);
  });

  it("a refusal also disables Promote anyway on a failed screening", () => {
    preview = { promotable: false, refusal: "Refused", setup: null, nextFires: [] };
    renderVerdict(false);
    expect((screen.getByTestId("sheet-promote-anyway") as HTMLButtonElement).disabled).toBe(true);
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
    renderVerdict(true);
    const panel = screen.getByTestId("glyph-promote-preview");
    expect(panel.textContent).toContain("gmail");
    expect(panel.textContent).toContain("schedule");
    const button = screen.getByTestId("glyph-promote-button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(precedes(screen.getByTestId("sheet-promote-preview"), button)).toBe(true);
  });

  it("no preview yet renders no panel and never blocks Promote", () => {
    renderVerdict(true);
    expect(screen.queryByTestId("glyph-promote-preview")).toBeNull();
    expect(screen.queryByTestId("glyph-promote-refusal")).toBeNull();
    expect((screen.getByTestId("glyph-promote-button") as HTMLButtonElement).disabled).toBe(false);
  });
});
