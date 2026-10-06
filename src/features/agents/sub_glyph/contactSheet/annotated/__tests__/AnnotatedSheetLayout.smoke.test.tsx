/** Smoke test for WP1 "Annotated Sheet": the layout mounts in every act on a
 *  fixture of the sheet state (useSheetState is the live-hook boundary, mocked
 *  the way glyphPromotePreview.test.tsx fixtures ActPanel), the testids the
 *  container and the e2e suite rely on survive, and a frame click opens the
 *  DETAIL layer with the frame's controls as zones. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../../cinema/useSheetState";
import type { SheetAct, FrameState } from "../../cinema/sheetModel";
import type { FrameValue } from "../../cinema/useFrameValues";

let state: SheetState;
vi.mock("../../cinema/useSheetState", () => ({ useSheetState: () => state }));
vi.mock("@/features/agents/sub_glyph/usePromotePreview", () => ({ usePromotePreview: () => null }));
vi.mock("../../cinema/SheetModals", () => ({ SheetModals: () => null }));
vi.mock("@/features/agents/sub_glyph/personaCore", async (orig) => ({
  ...(await orig<typeof import("@/features/agents/sub_glyph/personaCore")>()),
  PersonaCoreEntry: () => null,
}));

import { AnnotatedSheetLayout } from "../AnnotatedSheetLayout";

const noop = () => {};
const per = <T,>(f: (d: GlyphDimension) => T) => Object.fromEntries(GLYPH_DIMENSIONS.map((d) => [d, f(d)])) as Record<GlyphDimension, T>;

const ROW: GlyphRow = {
  id: "r1", title: "Digest unread mail", enabled: true, triggers: [], connectors: [{ name: "gmail", label: "Gmail" }] as GlyphRow["connectors"],
  steps: [], events: [], presence: per((d) => (d === "connector" || d === "task" ? "linked" : "none")), shared: false,
};
const APPS: FrameValue = { caption: "Gmail", lines: ["Gmail"], apps: ["gmail"], by: "ai" };

const WINNER = { id: "c0", form: 0, color: "#a78bfa" };
function stateFor(act: SheetAct): SheetState {
  const compose = act === "compose";
  const lit = !compose && act !== "casting" && act !== "stopped";
  const values = per<FrameValue | null>((d) => (d === "connector" && (lit || compose) ? APPS : null));
  const fixture = {
    act, isCompose: compose, sessionId: compose ? null : "s1",
    flow: {
      stage: "intro", qs: act === "questions" ? [{ cellKey: "connectors", question: "Which inbox?", options: null }] : [], n: act === "questions" ? 1 : 0, qi: 0,
      current: null, answeredByDim: {}, open: noop, pullBack: noop, send: noop, next: noop, prev: noop, pick: noop, setDraft: noop, draftOf: () => "",
    },
    frameStates: per<FrameState>((d) => (d === "connector" && (lit || compose) ? "lit" : "blank")),
    petalStates: per(() => "idle"), values, frameValues: values,
    clock: { elapsed: 42, marks: [], running: act === "casting" ? "build" : null, partial: false },
    cast: { candidates: [WINNER], eliminated: new Set(), finalists: new Set(["c0"]), phase: act === "casting" ? "casting" : "crowned", winner: WINNER, accent: WINNER.color },
    cfg: { items: [], modals: null },
    core: { preset: null, configured: false },
    launch: noop, launching: false,
    recipes: { shown: [], suggestion: null, picked: null, open: null, setOpen: noop, select: noop, dismiss: noop },
    presence: 0.5,
  };
  // Test fixture: the layout reads only these fields; the full shape is live hooks' output.
  return fixture as unknown as SheetState;
}

function props(act: SheetAct): GlyphFullLayoutProps {
  const phase = { compose: null, casting: "analyzing", questions: "awaiting_input", wiring: "resolving", draft: "draft_ready", screening: "testing", verdict: "test_complete", premiere: "promoted", stopped: "failed" }[act];
  // Test fixture: callbacks are inert; only what the acts render is real.
  return {
    intentText: "Summarize my unread emails", onIntentChange: noop, onLaunch: noop, launchDisabled: false,
    isBuilding: act === "casting" || act === "wiring", buildPhase: phase, completeness: 0, cellStates: {},
    pendingQuestions: null, onAnswer: noop, agentName: "Inbox Scout", onAgentNameChange: noop,
    hasDesignResult: !["compose", "casting", "stopped"].includes(act), glyphRows: ["compose", "casting", "stopped"].includes(act) ? [] : [ROW],
    onStartTest: noop, onPromote: noop, onPromoteForce: noop, onRejectTest: noop, onRefine: noop, onViewAgent: noop,
    buildError: act === "stopped" ? "The build stopped." : null, testPassed: act === "verdict" ? true : null,
    toolTestResults: [], cliOutputLines: ["reading the brief"],
  } as unknown as GlyphFullLayoutProps;
}

const EXPECT: Record<SheetAct, string[]> = {
  compose: ["agent-intent-input", "agent-launch-btn"],
  casting: ["sheet-cinema-action-panel", "sheet-cinema-build-log-open", "annotated-identity"],
  questions: ["sheet-cinema-action-panel", "annotated-identity"],
  wiring: ["sheet-cinema-action-panel", "sheet-cinema-build-log-open"],
  draft: ["sheet-cinema-action-panel", "build-simulate-open"],
  screening: ["sheet-cinema-action-panel"],
  verdict: ["sheet-cinema-action-panel", "glyph-promote-button", "build-test-report-open", "annotated-stamp"],
  premiere: ["sheet-cinema-action-panel", "annotated-stamp"],
  stopped: ["sheet-cinema-action-panel"],
};

describe("AnnotatedSheetLayout", () => {
  beforeEach(() => { vi.useRealTimers(); });

  for (const act of ["compose", "casting", "questions", "wiring", "draft", "screening", "verdict", "premiere", "stopped"] as SheetAct[]) {
    it(`renders the ${act} act with its controls`, () => {
      state = stateFor(act);
      render(<AnnotatedSheetLayout {...props(act)} />);
      expect(screen.getByTestId("AnnotatedSheetLayout")).toBeTruthy();
      for (const dim of GLYPH_DIMENSIONS) expect(screen.getByTestId(`annotated-frame-${dim}`)).toBeTruthy();
      for (const id of EXPECT[act]) expect(screen.getByTestId(id)).toBeTruthy();
    });
  }

  it("draws a populated frame as drafting first, then inks it when the pen reaches it", async () => {
    state = stateFor("draft");
    render(<AnnotatedSheetLayout {...props("draft")} />);
    const frame = screen.getByTestId("annotated-frame-connector");
    expect(["drafting", "inked"]).toContain(frame.getAttribute("data-ink"));
    await vi.waitFor(() => expect(frame.getAttribute("data-ink")).toBe("inked"), { timeout: 3000 });
    expect(screen.getByTestId("annotated-frame-trigger").getAttribute("data-ink")).toBe("pending");
  });

  for (const act of ["compose", "draft"] as SheetAct[]) {
    it(`opens the detail drawing on a frame click (${act})`, async () => {
      state = stateFor(act);
      render(<AnnotatedSheetLayout {...props(act)} />);
      fireEvent.click(within(screen.getByTestId("annotated-frame-connector")).getByRole("button"));
      const detail = await screen.findByTestId("annotated-detail");
      expect(within(detail).getByTestId("annotated-detail-figure")).toBeTruthy();
      expect(within(detail).getByTestId("annotated-zone-purpose")).toBeTruthy();
      if (act === "draft") expect(within(detail).getByTestId("annotated-zone-caps")).toBeTruthy();
    });
  }
});
