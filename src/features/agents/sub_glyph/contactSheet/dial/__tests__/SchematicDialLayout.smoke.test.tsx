/** Smoke test for the Schematic Dial (spark onboarding-blueprint WP3): the
 *  layout mounts in every act on a fake sheet state, the build flow's testids
 *  are where each act has them, the eight sectors and readouts are drawn, and
 *  a sector click opens the exploded view (and Esc re-seats it). */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act as rtlAct, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { DIM_TO_CELL_KEY } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import type { SheetState } from "../../cinema/useSheetState";
import type { SheetAct, FrameState } from "../../cinema/sheetModel";
import { makeCandidates } from "../../cinema/cinemaMotion";

let state: SheetState;
vi.mock("../../cinema/useSheetState", () => ({ useSheetState: () => state }));
vi.mock("@/features/agents/sub_glyph/usePromotePreview", () => ({ usePromotePreview: () => null }));
vi.mock("@/features/agents/sub_glyph/personaCore", async (orig) => ({
  ...(await orig<typeof import("@/features/agents/sub_glyph/personaCore")>()),
  PersonaCoreEntry: () => null,
}));

import { SchematicDialLayout } from "../SchematicDialLayout";

const noop = () => {};

beforeAll(() => {
  // A stage the size of a 1280 x 800 window's build area, so the dial is drawn.
  class SizedObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 1100, height: 620 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = SizedObserver;
});

function makeState(act: SheetAct, over: Partial<Record<GlyphDimension, FrameState>> = {}): SheetState {
  const candidates = makeCandidates(12);
  const crowned = act !== "compose" && act !== "casting";
  const frameStates = {} as Record<GlyphDimension, FrameState>;
  const values = {} as Record<GlyphDimension, unknown>;
  for (const d of GLYPH_DIMENSIONS) { frameStates[d] = over[d] ?? "blank"; values[d] = null; }
  if (frameStates.connector === "lit") values.connector = { caption: "Gmail, Slack", lines: ["Gmail", "Slack"], apps: ["gmail", "slack"], by: "ai" };
  const qs = act === "questions" ? [{ cellKey: DIM_TO_CELL_KEY.trigger, question: "When should it run?", options: null }] : [];
  // Test fixture: the dial reads only these fields of the sheet state; the
  // full shape carries live hooks' output (store, IPC, timers).
  return {
    sessionId: act === "compose" ? null : "session-abc123", isCompose: act === "compose", act,
    core: { preset: null, configured: false, state: {}, launchAugmentation: () => null },
    cfg: { items: [], modals: null, launch: noop },
    launch: noop, launching: false,
    recipes: { shown: [{ recipe_id: "r1", recipe_name: "Inbox digest", score: 0.4, above_threshold: false }], suggestion: null, picked: null, open: false, setOpen: noop, select: noop, dismiss: noop },
    flow: {
      qs, n: qs.length, qi: 0, current: null, stage: "intro", allDrafted: false, answeredByDim: {},
      draftOf: () => "", setDraft: noop, next: noop, prev: noop, pick: noop, open: noop, pullBack: noop, send: noop,
    },
    clock: { elapsed: 42, marks: [], running: act === "casting" ? "build" : null, partial: false },
    cast: {
      candidates, phase: crowned ? "crowned" : "casting", eliminated: new Set<string>(), finalists: new Set<string>(),
      winner: candidates[0], accent: candidates[0]!.color,
    },
    values, frameValues: values, frameStates, petalStates: {}, presence: 0.5,
  } as unknown as SheetState;
}

function props(over: Partial<GlyphFullLayoutProps> = {}): GlyphFullLayoutProps {
  return {
    intentText: "Summarize my unread email each morning", onIntentChange: noop, onLaunch: noop, launchDisabled: false,
    isBuilding: false, buildPhase: null, completeness: 0, cellStates: {}, pendingQuestions: null, onAnswer: noop,
    agentName: "Inbox Herald", onAgentNameChange: noop, hasDesignResult: false, glyphRows: [],
    onStartTest: noop, onPromote: noop, onPromoteForce: noop, onRejectTest: noop, onRefine: noop, onViewAgent: noop,
    buildError: null, cliOutputLines: ["reading the brief"], toolTestResults: [], ...over,
  };
}

const ids = (...names: string[]) => names.forEach((n) => expect(screen.getAllByTestId(n).length).toBeGreaterThan(0));

describe("SchematicDialLayout", () => {
  beforeEach(() => { state = makeState("compose"); });

  it("compose: the composer and recipe starters sit in the hub, eight sectors and readouts around it", () => {
    render(<SchematicDialLayout {...props({ launchError: "Could not start", onDismissLaunchError: noop })} />);
    ids("SchematicDialLayout", "dial-figure", "dial-hub", "agent-intent-input", "agent-launch-btn", "sheet-cinema-recipe-starters", "sheet-cinema-launch-error");
    for (const d of GLYPH_DIMENSIONS) ids(`dial-sector-${d}`, `dial-readout-${d}`);
  });

  it("casting: the crowd orbits and the hub carries the action panel and the log", () => {
    state = makeState("casting", { task: "filling" });
    render(<SchematicDialLayout {...props({ isBuilding: true, buildPhase: "analyzing" })} />);
    ids("sheet-cinema-action-panel", "sheet-cinema-build-log-open");
  });

  it("questions: the panel offers the questions; the drawing inks one step per beat", async () => {
    state = makeState("questions", { trigger: "pending", connector: "lit" });
    render(<SchematicDialLayout {...props({ buildPhase: "awaiting_input" })} />);
    ids("sheet-cinema-action-panel");
    // Step 1 (the asked trigger) lands at once, step 2 (the inked connector) a beat later.
    expect(screen.getByTestId("dial-readout-connector").textContent).not.toContain("Gmail");
    await waitFor(() => expect(screen.getByTestId("dial-readout-connector").textContent).toContain("Gmail"), { timeout: 3000 });
  });

  it("draft: the title card's panel carries simulate", () => {
    state = makeState("draft", { connector: "lit" });
    render(<SchematicDialLayout {...props({ hasDesignResult: true, buildPhase: "draft_ready" })} />);
    ids("sheet-cinema-action-panel", "build-simulate-open");
  });

  it("verdict: promote and the report when passed; promote-anyway when the screening failed", () => {
    state = makeState("verdict", { connector: "lit" });
    const { unmount } = render(<SchematicDialLayout {...props({ hasDesignResult: true, buildPhase: "test_complete", testPassed: true })} />);
    ids("glyph-promote-button", "build-test-report-open");
    unmount();
    render(<SchematicDialLayout {...props({ hasDesignResult: true, buildPhase: "test_complete", testPassed: false, testError: "a tool failed" })} />);
    ids("build-test-report-open", "sheet-promote-anyway");
  });

  it("premiere and stopped render their panel", () => {
    state = makeState("premiere", { connector: "lit" });
    const { unmount } = render(<SchematicDialLayout {...props({ hasDesignResult: true, buildPhase: "promoted" })} />);
    ids("sheet-cinema-action-panel");
    unmount();
    state = makeState("stopped");
    render(<SchematicDialLayout {...props({ buildPhase: "failed", buildError: "boom" })} />);
    ids("sheet-cinema-action-panel");
  });

  it("a sector click explodes it into the fan and its controls; Esc re-seats it", async () => {
    state = makeState("draft", { connector: "lit" });
    render(<SchematicDialLayout {...props({ hasDesignResult: true, buildPhase: "draft_ready" })} />);
    fireEvent.click(screen.getByTestId("dial-sector-connector"));
    ids("dial-exploded", "dial-exploded-fan", "dial-exploded-controls");
    expect(screen.getByTestId("dial-exploded").getAttribute("aria-label")).toBeTruthy();
    await rtlAct(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await waitFor(() => expect(screen.queryByTestId("dial-exploded")).toBeNull(), { timeout: 3000 });
  });

  it("a readout opens the same exploded view", () => {
    render(<SchematicDialLayout {...props()} />);
    fireEvent.click(screen.getByTestId("dial-readout-memory"));
    ids("dial-exploded", "dial-exploded-controls");
  });
});
