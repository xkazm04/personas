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
  buildPersonaId: string | null;
  buildSessionId: string | null;
  buildPhase: BuildPhase;
  buildCellStates: Record<string, CellBuildStatus>;
  /** Resolved dimension data — keyed by cell key, contains items/summary from CLI */
  buildCellData: Record<string, { items?: string[]; summary?: string }>;
  buildPendingQuestions: BuildQuestion[];
  buildProgress: number;
  buildOutputLines: string[];
  buildError: string | null;
  buildDraft: unknown | null;

  /** Manual connector-to-credential links made during build flow */
  buildConnectorLinks: Record<string, string>;

  /** Workflow import state — populated when user imports a workflow file */
  buildWorkflowJson: string | null;
  buildParserResultJson: string | null;
  buildWorkflowName: string | null;
  buildWorkflowPlatform: string | null;

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

  // Actions -- connector links
  linkBuildConnector: (connectorName: string, credentialId: string) => void;
  unlinkBuildConnector: (connectorName: string) => void;

  // Actions -- workflow import
  setWorkflowImport: (params: {
    workflowJson: string;
    parserResultJson: string;
    name: string;
    platform: string;
  }) => void;
  clearWorkflowImport: () => void;

  // Actions -- test lifecycle
  handleStartTest: (testId: string) => void;
  handleTestComplete: (passed: boolean, outputPreview: string) => void;
  handleTestFailed: (error: string) => void;
  handleRejectTest: () => void;
  appendTestOutput: (line: string) => void;

  // Actions -- lifecycle
  resetBuildSession: () => void;
  hydrateBuildSession: (session: PersistedBuildSession) => void;
}

// -- Max output buffer size -------------------------------------------------

const MAX_OUTPUT_LINES = 500;
const MAX_TEST_OUTPUT_LINES = 200;

// -- Slice creator ----------------------------------------------------------

export const createMatrixBuildSlice: StateCreator<
  AgentStore,
  [],
  [],
  MatrixBuildSlice
> = (set) => ({
  // Initial state
  buildPersonaId: null,
  buildSessionId: null,
  buildPhase: "initializing",
  buildCellStates: {},
  buildCellData: {},
  buildPendingQuestions: [],
  buildProgress: 0,
  buildOutputLines: [],
  buildError: null,
  buildDraft: null,
  buildConnectorLinks: {},
  buildWorkflowJson: null,
  buildParserResultJson: null,
  buildWorkflowName: null,
  buildWorkflowPlatform: null,

  // Test lifecycle initial state
  buildTestId: null,
  buildTestPassed: null,
  buildTestOutputLines: [],
  buildTestError: null,

  // -- Event handlers -------------------------------------------------------

  handleBuildCellUpdate: (event) => {
    set((s) => {
      // Store full agent_ir in buildDraft when it arrives during live session
      if (event.cell_key === "agent_ir") {
        const data = typeof event.data === 'string'
          ? (() => { try { return JSON.parse(event.data as string); } catch { return event.data; } })()
          : event.data;
        return { buildDraft: data };
      }

      // Parse data for items/summary if present
      const cellData = { ...s.buildCellData };
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && typeof data === 'object') {
          const items = (data as Record<string, unknown>).items as string[] | undefined;
          const summary = (data as Record<string, unknown>).summary as string | undefined;
          if (items || summary) {
            cellData[event.cell_key] = { items, summary };
          }
        }
      } catch { /* ignore parse errors */ }

      return {
        buildCellStates: {
          ...s.buildCellStates,
          [event.cell_key]: event.status as CellBuildStatus,
        },
        buildCellData: cellData,
      };
    });
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

  appendTestOutput: (line) => {
    set((s) => {
      const nextLines = [...s.buildTestOutputLines, line];
      const trimmed =
        nextLines.length > MAX_TEST_OUTPUT_LINES
          ? nextLines.slice(nextLines.length - MAX_TEST_OUTPUT_LINES)
          : nextLines;
      return { buildTestOutputLines: trimmed };
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

  // -- Connector link management --------------------------------------------

  linkBuildConnector: (connectorName, credentialId) => {
    set((s) => ({
      buildConnectorLinks: {
        ...s.buildConnectorLinks,
        [connectorName]: credentialId,
      },
    }));
  },

  unlinkBuildConnector: (connectorName) => {
    set((s) => {
      const next = { ...s.buildConnectorLinks };
      delete next[connectorName];
      return { buildConnectorLinks: next };
    });
  },

  // -- Workflow import management ------------------------------------------

  setWorkflowImport: (params) => {
    set({
      buildWorkflowJson: params.workflowJson,
      buildParserResultJson: params.parserResultJson,
      buildWorkflowName: params.name,
      buildWorkflowPlatform: params.platform,
    });
  },

  clearWorkflowImport: () => {
    set({
      buildWorkflowJson: null,
      buildParserResultJson: null,
      buildWorkflowName: null,
      buildWorkflowPlatform: null,
    });
  },

  // -- Lifecycle actions ----------------------------------------------------

  resetBuildSession: () => {
    set({
      buildPersonaId: null,
      buildSessionId: null,
      buildPhase: "initializing",
      buildCellStates: {},
      buildCellData: {},
      buildPendingQuestions: [],
      buildProgress: 0,
      buildOutputLines: [],
      buildError: null,
      buildDraft: null,
      buildConnectorLinks: {},
      buildWorkflowJson: null,
      buildParserResultJson: null,
      buildWorkflowName: null,
      buildWorkflowPlatform: null,
      buildTestId: null,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
    });
  },

  hydrateBuildSession: (session) => {
    // Build cell states from resolved_cells: each resolved cell -> "resolved" status
    const cellStates: Record<string, CellBuildStatus> = {};
    const resolvedCells = session.resolved_cells ?? {};
    for (const key of Object.keys(resolvedCells)) {
      cellStates[key] = "resolved";
    }

    // Handle backward compat: backend sends single pending_question (not array).
    // Wrap into array if present, empty array if null. Guard against malformed data.
    const pendingQuestions: BuildQuestion[] = [];
    if (session.pending_question && typeof session.pending_question === 'object') {
      const pq = session.pending_question as unknown as Record<string, unknown>;
      if (pq.cell_key || pq.cellKey) {
        pendingQuestions.push({
          cellKey: (pq.cellKey ?? pq.cell_key) as string,
          question: (pq.question as string) ?? '',
          options: (pq.options as string[] | null) ?? null,
        });
      }
    }

    // Extract connector links from agent_ir if present
    let connectorLinks: Record<string, string> = {};
    if (session.agent_ir && typeof session.agent_ir === 'object') {
      const ir = session.agent_ir as Record<string, unknown>;
      if (ir.credential_links && typeof ir.credential_links === 'object') {
        connectorLinks = ir.credential_links as Record<string, string>;
      }
    }

    set({
      buildSessionId: session.id,
      buildPhase: session.phase,
      buildCellStates: cellStates,
      buildPendingQuestions: pendingQuestions,
      buildDraft: session.agent_ir,
      buildError: session.error_message,
      buildConnectorLinks: connectorLinks,
    });
  },
});
