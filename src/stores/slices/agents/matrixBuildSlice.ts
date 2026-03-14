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
  buildCurrentQuestion: BuildQuestion | null;
  buildProgress: number;
  buildOutputLines: string[];
  buildError: string | null;
  buildDraft: unknown | null;

  // Actions -- event handlers
  handleBuildCellUpdate: (event: Extract<BuildEvent, { type: "cell_update" }>) => void;
  handleBuildQuestion: (event: Extract<BuildEvent, { type: "question" }>) => void;
  handleBuildProgress: (event: Extract<BuildEvent, { type: "progress" }>) => void;
  handleBuildError: (event: Extract<BuildEvent, { type: "error" }>) => void;
  handleBuildSessionStatus: (event: Extract<BuildEvent, { type: "session_status" }>) => void;

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
  buildCurrentQuestion: null,
  buildProgress: 0,
  buildOutputLines: [],
  buildError: null,
  buildDraft: null,

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
      buildCurrentQuestion: {
        cellKey: event.cell_key,
        question: event.question,
        options: event.options,
      },
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

  // -- Lifecycle actions ----------------------------------------------------

  resetBuildSession: () => {
    set({
      buildSessionId: null,
      buildPhase: "initializing",
      buildCellStates: {},
      buildCurrentQuestion: null,
      buildProgress: 0,
      buildOutputLines: [],
      buildError: null,
      buildDraft: null,
    });
  },

  hydrateBuildSession: (session) => {
    // Build cell states from resolved_cells: each resolved cell -> "resolved" status
    const cellStates: Record<string, CellBuildStatus> = {};
    for (const key of Object.keys(session.resolved_cells)) {
      cellStates[key] = "resolved";
    }

    set({
      buildSessionId: session.id,
      buildPhase: session.phase,
      buildCellStates: cellStates,
      buildCurrentQuestion: session.pending_question,
      buildDraft: session.agent_ir,
      buildError: session.error_message,
    });
  },
});
