/**
 * Zustand slice for matrix build session state.
 *
 * Replaces ephemeral useReducer patterns so build state survives React
 * component unmount and remount (navigation). Build state is persisted to
 * SQLite (not localStorage) -- hydration happens via hydrateBuildSession().
 */
import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import type {
  BuildPhase,
  BuildEvent,
  BuildQuestion,
  PersistedBuildSession,
  CellBuildStatus,
} from "@/lib/types/buildTypes";

// -- Slice interface --------------------------------------------------------

export interface MatrixBuildSlice {
  // State
  buildSessionId: string | null;
  buildPhase: BuildPhase;
  buildCellStates: Record<string, CellBuildStatus>;
  buildPendingQuestions: BuildQuestion[];
  buildProgress: number;
  buildOutputLines: string[];
  buildError: string | null;
  buildDraft: unknown | null;

  // Test lifecycle state
  buildTestId: string | null;
  buildTestPassed: boolean | null;
  buildTestOutputLines: string[];
  buildTestError: string | null;

  // Actions -- event handlers
  handleBuildCellUpdate: (event: Extract<BuildEvent, { type: "cell_update" }>) => void;
  handleBuildQuestion: (event: Extract<BuildEvent, { type: "question" }>) => void;
  handleBuildProgress: (event: Extract<BuildEvent, { type: "progress" }>) => void;
  handleBuildError: (event: Extract<BuildEvent, { type: "error" }>) => void;
  handleBuildSessionStatus: (event: Extract<BuildEvent, { type: "session_status" }>) => void;

  // Actions -- question management
  clearBuildQuestion: (cellKey: string) => void;

  // Actions -- test lifecycle
  handleStartTest: (testId: string) => void;
  handleTestComplete: (passed: boolean, outputPreview: string) => void;
  handleTestFailed: (error: string) => void;
  handleRejectTest: () => void;

  // Actions -- lifecycle
  resetBuildSession: () => void;
  hydrateBuildSession: (session: PersistedBuildSession) => void;
}

// -- Max output buffer size -------------------------------------------------

const MAX_OUTPUT_LINES = 500;

// -- Slice creator ----------------------------------------------------------

export const createMatrixBuildSlice: StateCreator<
  AgentStore,
  [],
  [],
  MatrixBuildSlice
> = (set) => ({
  // Initial state
  buildSessionId: null,
  buildPhase: "initializing",
  buildCellStates: {},
  buildPendingQuestions: [],
  buildProgress: 0,
  buildOutputLines: [],
  buildError: null,
  buildDraft: null,

  // Test lifecycle initial state
  buildTestId: null,
  buildTestPassed: null,
  buildTestOutputLines: [],
  buildTestError: null,

  // -- Event handlers -------------------------------------------------------

  handleBuildCellUpdate: (event) => {
    set((s) => ({
      buildCellStates: {
        ...s.buildCellStates,
        [event.cell_key]: event.status as CellBuildStatus,
      },
    }));
  },

  handleBuildQuestion: (event) => {
    set((s) => ({
      buildPendingQuestions: [
        ...s.buildPendingQuestions,
        {
          cellKey: event.cell_key,
          question: event.question,
          options: event.options,
        },
      ],
      buildCellStates: {
        ...s.buildCellStates,
        [event.cell_key]: "highlighted",
      },
      buildPhase: "awaiting_input",
    }));
  },

  handleBuildProgress: (event) => {
    set((s) => {
      const nextLines = [...s.buildOutputLines, event.message];
      // Keep only the last MAX_OUTPUT_LINES entries
      const trimmed =
        nextLines.length > MAX_OUTPUT_LINES
          ? nextLines.slice(nextLines.length - MAX_OUTPUT_LINES)
          : nextLines;

      return {
        buildOutputLines: trimmed,
        ...(event.percent != null ? { buildProgress: event.percent } : {}),
      };
    });
  },

  handleBuildError: (event) => {
    set({
      buildError: event.message,
      buildPhase: "failed",
    });
  },

  handleBuildSessionStatus: (event) => {
    const progress =
      event.total_count > 0
        ? (event.resolved_count / event.total_count) * 100
        : 0;
    set({
      buildPhase: event.phase as BuildPhase,
      buildProgress: progress,
    });
  },

  // -- Test lifecycle actions ------------------------------------------------

  handleStartTest: (testId) => {
    set({
      buildPhase: "testing",
      buildTestId: testId,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
    });
  },

  handleTestComplete: (passed, outputPreview) => {
    set({
      buildPhase: "test_complete",
      buildTestPassed: passed,
      buildTestOutputLines: [outputPreview],
    });
  },

  handleTestFailed: (error) => {
    set({
      buildPhase: "test_complete",
      buildTestPassed: false,
      buildTestError: error,
    });
  },

  handleRejectTest: () => {
    set({
      buildPhase: "draft_ready",
      buildTestId: null,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
    });
  },

  // -- Question management --------------------------------------------------

  clearBuildQuestion: (cellKey) => {
    set((s) => ({
      buildPendingQuestions: s.buildPendingQuestions.filter(
        (q) => q.cellKey !== cellKey,
      ),
    }));
  },

  // -- Lifecycle actions ----------------------------------------------------

  resetBuildSession: () => {
    set({
      buildSessionId: null,
      buildPhase: "initializing",
      buildCellStates: {},
      buildPendingQuestions: [],
      buildProgress: 0,
      buildOutputLines: [],
      buildError: null,
      buildDraft: null,
      buildTestId: null,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
    });
  },

  hydrateBuildSession: (session) => {
    // Build cell states from resolved_cells: each resolved cell -> "resolved" status
    const cellStates: Record<string, CellBuildStatus> = {};
    for (const key of Object.keys(session.resolved_cells)) {
      cellStates[key] = "resolved";
    }

    // Handle backward compat: backend sends single pending_question (not array).
    // Wrap into array if present, empty array if null.
    const pendingQuestions: BuildQuestion[] = session.pending_question
      ? [session.pending_question]
      : [];

    set({
      buildSessionId: session.id,
      buildPhase: session.phase,
      buildCellStates: cellStates,
      buildPendingQuestions: pendingQuestions,
      buildDraft: session.agent_ir,
      buildError: session.error_message,
    });
  },
});
