/** Smoke test for the Drafting Sheet (spark onboarding-blueprint WP2): the
 *  layout mounts in every act on a fabricated sheet state, the Cinema testids
 *  each act carries survive the transplant, the stamp lands where it should,
 *  and a region click turns to that dimension's own sheet (and Back returns). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act as rtlAct, fireEvent, render, screen } from "@testing-library/react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../../cinema/useSheetState";
import type { SheetAct } from "../../cinema/sheetModel";
import { makeCandidates } from "../../cinema/cinemaMotion";
import { useAgentStore } from "@/stores/agentStore";

let state: SheetState;
vi.mock("@/features/agents/sub_glyph/contactSheet/cinema/useSheetState", () => ({ useSheetState: () => state }));
vi.mock("@/features/agents/sub_glyph/contactSheet/cinema/SheetLayers", () => ({ SheetLayers: () => null, layerShot: () => null }));
vi.mock("@/features/agents/sub_glyph/contactSheet/cinema/SheetModals", () => ({ SheetModals: () => null }));
vi.mock("@/features/agents/sub_glyph/contactSheet/cinema/useSheetKeys", () => ({ useSheetKeys: () => {} }));
vi.mock("@/features/agents/sub_glyph/contactSheet/cinema/quickSetup/QuickSetup", () => ({
  hasQuickSetup: () => false, QuickSetup: () => null, DecidedSetup: () => <div data-testid="decided-setup" />,
}));
vi.mock("@/features/agents/sub_glyph/usePromotePreview", () => ({ usePromotePreview: () => null }));
vi.mock("@/features/agents/sub_glyph/personaCore", () => ({ PersonaCoreEntry: () => null, recordPersonaCoreClose: () => {} }));

import { DraftingSheetLayout } from "../DraftingSheetLayout";

const noop = () => {};
const record = <T,>(f: (d: GlyphDimension) => T) => Object.fromEntries(GLYPH_DIMENSIONS.map((d) => [d, f(d)])) as Record<GlyphDimension, T>;

function fakeState(act: SheetAct): SheetState {
  const compose = act === "compose";
  const candidates = makeCandidates(12);
  const task = compose ? null : { caption: "2 capabilities", lines: ["Read mail", "Summarise"], caps: ["Read mail", "Summarise"], by: "ai" as const };
  const values = record((d) => (d === "task" ? task : null));
  // Test fixture: the layout reads only these fields; the real shape carries live hooks' output.
  return {
    sessionId: compose ? null : "s1", isCompose: compose, act,
    core: {}, launch: noop, launching: false,
    cfg: { items: [], modals: null },
    recipes: { shown: [{ recipe_id: "r1", recipe_name: "Inbox digest", score: 0.8 }], suggestion: null, setOpen: noop, dismiss: noop, picked: null, open: null, select: noop },
    flow: { stage: act === "questions" ? "intro" : "intro", qs: [], n: 0, qi: 0, current: null, open: noop, pullBack: noop, next: noop, prev: noop, pick: noop, send: noop, draftOf: () => "", setDraft: noop, answeredByDim: {} },
    clock: { elapsed: 42, marks: [], running: act === "casting" ? "build" : null, partial: false },
    cast: { candidates, phase: act === "casting" ? "casting" : "crowned", eliminated: new Set(), finalists: new Set(), winner: candidates[0]!, accent: "#60A5FA" },
    values, frameValues: values,
    frameStates: record((d) => (compose ? "blank" : d === "task" ? "lit" : d === "connector" ? "filling" : "unset")),
    petalStates: record(() => "idle"), presence: 0.5,
  } as unknown as SheetState;
}

function props(act: SheetAct, over: Partial<GlyphFullLayoutProps> = {}): GlyphFullLayoutProps {
  const phase = { compose: null, casting: "analyzing", questions: "awaiting_input", wiring: "resolving", draft: "draft_ready", screening: "testing", verdict: "test_complete", premiere: "promoted", stopped: "failed" }[act];
  // Test fixture: the props a container hands the layout, minus what no act reads.
  return {
    intentText: "Summarise my inbox", onIntentChange: noop, onLaunch: noop, launchDisabled: false,
    isBuilding: act === "casting" || act === "wiring", buildPhase: phase, completeness: 0, cellStates: {},
    pendingQuestions: null, onAnswer: noop, agentName: "Inbox Owl", onAgentNameChange: noop,
    hasDesignResult: act !== "compose" && act !== "casting", glyphRows: [], onStartTest: noop, onPromote: noop,
    onPromoteForce: noop, onRejectTest: noop, onRefine: noop, onViewAgent: noop, buildError: act === "stopped" ? "boom" : null,
    cliOutputLines: act === "compose" ? [] : ["reading brief", "drafting capabilities"], testPassed: true, toolTestResults: [],
    launchError: act === "compose" ? "could not start" : null, onDismissLaunchError: noop,
    ...over,
  } as unknown as GlyphFullLayoutProps;
}

function mount(act: SheetAct, over: Partial<GlyphFullLayoutProps> = {}) {
  state = fakeState(act);
  return render(<DraftingSheetLayout {...props(act, over)} />);
}

describe("DraftingSheetLayout smoke", () => {
  beforeEach(() => {
    useAgentStore.setState({ buildBehaviorCore: { identity: { role: "Inbox triager" }, mission: "Keep the inbox at zero." } } as never);
  });

  it("compose: the composer, launch, error and starters sit in the drawing", () => {
    mount("compose");
    expect(screen.getByTestId("DraftingSheetLayout")).toBeTruthy();
    expect(screen.getByTestId("agent-intent-input")).toBeTruthy();
    expect(screen.getByTestId("agent-launch-btn")).toBeTruthy();
    expect(screen.getByTestId("sheet-cinema-launch-error")).toBeTruthy();
    expect(screen.getByTestId("sheet-cinema-recipe-starters")).toBeTruthy();
    expect(screen.queryByTestId("sheet-cinema-action-panel")).toBeNull();
  });

  it.each(["casting", "questions", "wiring", "draft", "screening", "verdict", "premiere", "stopped"] as SheetAct[])("%s: renders with the docked action panel", (a) => {
    mount(a);
    expect(screen.getByTestId("drafting-title-block")).toBeTruthy();
    expect(screen.getByTestId("sheet-cinema-action-panel")).toBeTruthy();
  });

  it("casting: the build log door survives", () => {
    mount("casting");
    expect(screen.getByTestId("sheet-cinema-build-log-open")).toBeTruthy();
  });

  it("draft: the dry run opens from the dock", () => {
    mount("draft");
    expect(screen.getByTestId("build-simulate-open")).toBeTruthy();
  });

  it("verdict: promote and the report, and the APPROVED stamp", () => {
    mount("verdict");
    expect(screen.getByTestId("glyph-promote-button")).toBeTruthy();
    expect(screen.getByTestId("build-test-report-open")).toBeTruthy();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("verdict failed: promote anyway sits behind its confirm door", () => {
    mount("verdict", { testPassed: false });
    expect(screen.getByTestId("sheet-promote-anyway")).toBeTruthy();
  });

  it("stopped: the VOID stamp", () => {
    mount("stopped");
    expect(screen.getAllByText("Void").length).toBeGreaterThan(0);
  });

  it("a region click turns to its own sheet, and back returns to sheet 1", async () => {
    mount("draft");
    fireEvent.click(await screen.findByTestId("drafting-region-task", {}, { timeout: 3000 }));
    expect(await screen.findByTestId("drafting-sheet-task")).toBeTruthy();
    expect(screen.getByTestId("drafting-dimension-block")).toBeTruthy();
    expect(screen.getByText("Sheet 3 of 9")).toBeTruthy();
    expect(screen.getByTestId("decided-setup")).toBeTruthy();
    await rtlAct(async () => { fireEvent.click(screen.getByTestId("drafting-sheet-back")); });
    expect(screen.getByTestId("drafting-sheet-1")).toBeTruthy();
  });

  it("compose: a region opens the dimension's sheet with its specification", async () => {
    mount("compose");
    fireEvent.click(await screen.findByTestId("drafting-region-trigger", {}, { timeout: 3000 }));
    expect(await screen.findByTestId("drafting-sheet-trigger")).toBeTruthy();
    expect(screen.getByText("Specification")).toBeTruthy();
  });
});
