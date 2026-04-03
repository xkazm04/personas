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
  ToolTestResult,
} from "@/lib/types/buildTypes";
import type { MatrixEditState } from "@/features/templates/sub_generated/gallery/matrix/matrixEditTypes";
import { storeBus } from "@/lib/storeBus";

// -- Slice interface --------------------------------------------------------

export interface MatrixBuildSlice {
  // State
  buildPersonaId: string | null;
  buildSessionId: string | null;
  buildPhase: BuildPhase;
  buildCellStates: Record<string, CellBuildStatus>;
  /** Resolved dimension data — keyed by cell key, contains items/summary/raw from CLI */
  buildCellData: Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }>;
  buildPendingQuestions: BuildQuestion[];
  buildProgress: number;
  buildOutputLines: string[];
  buildActivity: string | null;
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
  buildToolTestResults: ToolTestResult[];
  buildTestSummary: string | null;
  /** Connector resolution status from last test run */
  buildTestConnectors: Array<{ name: string; has_credential: boolean }>;

  // Actions -- event handlers
  handleBuildCellUpdate: (event: Extract<BuildEvent, { type: "cell_update" }>) => void;
  handleBuildQuestion: (event: Extract<BuildEvent, { type: "question" }>) => void;
  handleBuildProgress: (event: Extract<BuildEvent, { type: "progress" }>) => void;
  handleBuildError: (event: Extract<BuildEvent, { type: "error" }>) => void;
  handleBuildSessionStatus: (event: Extract<BuildEvent, { type: "session_status" }>) => void;

  // Collected answers waiting for user to click "Continue"
  buildPendingAnswers: Record<string, string>;

  // Actions -- question management
  clearBuildQuestion: (cellKey: string) => void;
  /** Store an answer locally without sending to CLI yet */
  collectAnswer: (cellKey: string, answer: string) => void;
  /** Clear all collected answers (after submission) */
  clearPendingAnswers: () => void;

  // Actions -- cell update confirmation
  confirmCellUpdate: (cellKey: string) => void;

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
  setToolTestResults: (results: ToolTestResult[]) => void;
  appendToolTestResult: (result: ToolTestResult) => void;
  setTestSummary: (summary: string) => void;
  setTestConnectors: (connectors: Array<{ name: string; has_credential: boolean }>) => void;

  // Post-build inline editing state
  buildEditState: MatrixEditState;
  buildEditDirty: boolean;
  editingCellKey: string | null;

  // Actions -- inline editing
  setEditingCell: (cellKey: string | null) => void;
  updateEditState: (partial: Partial<MatrixEditState>) => void;
  markEditDirty: () => void;
  clearEditDirty: () => void;
  initEditStateFromDraft: () => void;

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
  buildActivity: null,
  buildError: null,
  buildDraft: null,
  buildConnectorLinks: {},
  buildWorkflowJson: null,
  buildParserResultJson: null,
  buildWorkflowName: null,
  buildWorkflowPlatform: null,

  // Collected answers
  buildPendingAnswers: {},

  // Test lifecycle initial state
  buildTestId: null,
  buildTestPassed: null,
  buildTestOutputLines: [],
  buildTestError: null,
  buildToolTestResults: [],
  buildTestSummary: null,
  buildTestConnectors: [],

  // Post-build inline editing defaults
  buildEditState: {
    connectorCredentialMap: {},
    connectorSwaps: {},
    triggerConfigs: {},
    requireApproval: false,
    autoApproveSeverity: '',
    reviewTimeout: '',
    memoryEnabled: false,
    memoryScope: '',
    messagePreset: '',
    errorStrategy: '',
    useCases: [],
  },
  buildEditDirty: false,
  editingCellKey: null,

  // -- Event handlers -------------------------------------------------------

  handleBuildCellUpdate: (event) => {
    set((s) => {
      // Store full agent_ir in buildDraft when it arrives during live session
      if (event.cell_key === "agent_ir") {
        const data = typeof event.data === 'string'
          ? (() => { try { return JSON.parse(event.data as string); } catch { return event.data; } })()
          : event.data;
        // Also update persona name in the personas list so it's visible immediately
        const irName = data && typeof data === 'object' ? (data as Record<string, unknown>).name : undefined;
        if (typeof irName === 'string' && irName.length > 0 && s.buildPersonaId) {
          const pid = s.buildPersonaId;
          return {
            buildDraft: data,
            personas: s.personas.map(p => p.id === pid ? { ...p, name: irName } : p),
          };
        }
        return { buildDraft: data };
      }

      // Parse data for items/summary/raw if present
      const cellData = { ...s.buildCellData };
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>;
          const items = obj.items as string[] | undefined;
          const summary = obj.summary as string | undefined;
          // Store full raw data for cells that need extra fields (e.g. connectors.alternatives)
          cellData[event.cell_key] = { items, summary, raw: obj };
        }
      } catch { /* ignore parse errors */ }

      // Determine new cell status:
      // - First resolution: 'resolved' (green)
      // - Re-resolution after refinement: 'updated' (yellow) — user should review
      // - Skip if already in same state (prevents EventBridge duplicate processing)
      const prevStatus = s.buildCellStates[event.cell_key];
      const incomingStatus = event.status as CellBuildStatus;

      // Skip no-op: if cell is already resolved and incoming is also resolved,
      // only mark 'updated' if the data actually changed
      let newStatus: CellBuildStatus;
      if (prevStatus === incomingStatus && prevStatus === 'resolved') {
        // Check if data changed (refinement) vs duplicate event
        const oldItems = s.buildCellData[event.cell_key]?.items;
        const newData = typeof event.data === 'string' ? (() => { try { return JSON.parse(event.data as string); } catch { return null; } })() : event.data;
        const newItems = (newData as Record<string, unknown> | null)?.items;
        const dataChanged = JSON.stringify(oldItems) !== JSON.stringify(newItems);
        newStatus = dataChanged ? 'updated' : 'resolved';
      } else {
        newStatus = incomingStatus;
      }

      return {
        buildCellStates: {
          ...s.buildCellStates,
          [event.cell_key]: newStatus,
        },
        buildCellData: cellData,
      };
    });
  },

  handleBuildQuestion: (event) => {
    set((s) => {
      // Replace existing question for the same cell key (don't duplicate)
      const filtered = s.buildPendingQuestions.filter((q) => q.cellKey !== event.cell_key);
      return {
      buildPendingQuestions: [
        ...filtered,
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
    };});
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
        buildActivity: event.activity ?? s.buildActivity,
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
    set((s) => {
      if (s.buildPersonaId) storeBus.emit('build:phase-changed', { phase: event.phase, personaId: s.buildPersonaId });
      return {
        buildPhase: event.phase as BuildPhase,
        buildProgress: progress,
      };
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
    set((s) => {
      if (s.buildPersonaId) storeBus.emit('build:phase-changed', { phase: 'test_complete', personaId: s.buildPersonaId });
      return {
        buildPhase: "test_complete" as BuildPhase,
        buildTestPassed: passed,
        buildTestOutputLines: [outputPreview],
      };
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
      buildToolTestResults: [],
      buildTestSummary: null,
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

  setToolTestResults: (results) => {
    set({ buildToolTestResults: results });
  },

  appendToolTestResult: (result) => {
    set((s) => ({
      buildToolTestResults: [...s.buildToolTestResults, result],
    }));
  },

  setTestSummary: (summary) => {
    set({ buildTestSummary: summary });
  },

  setTestConnectors: (connectors: Array<{ name: string; has_credential: boolean }>) => {
    set({ buildTestConnectors: connectors });
  },

  // -- Question management --------------------------------------------------

  clearBuildQuestion: (cellKey) => {
    set((s) => ({
      buildPendingQuestions: s.buildPendingQuestions.filter(
        (q) => q.cellKey !== cellKey,
      ),
    }));
  },

  collectAnswer: (cellKey, answer) => {
    set((s) => ({
      buildPendingAnswers: { ...s.buildPendingAnswers, [cellKey]: answer },
      // Mark as "filling" — the CLI will confirm with "resolved" on the next turn.
      // Using "filling" prevents the handleBuildCellUpdate handler from seeing
      // a resolved→resolved transition and marking it as "updated".
      buildCellStates: {
        ...s.buildCellStates,
        [cellKey]: 'filling',
      },
      // Remove the question from pending list
      buildPendingQuestions: s.buildPendingQuestions.filter((q) => q.cellKey !== cellKey),
    }));
  },

  clearPendingAnswers: () => {
    set({ buildPendingAnswers: {} });
  },

  // -- Cell update confirmation -----------------------------------------------

  confirmCellUpdate: (cellKey) => {
    set((s) => ({
      buildCellStates: {
        ...s.buildCellStates,
        [cellKey]: "resolved",
      },
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

  // -- Inline editing actions -----------------------------------------------

  setEditingCell: (cellKey) => {
    set({ editingCellKey: cellKey });
  },

  updateEditState: (partial) => {
    set((s) => ({
      buildEditState: { ...s.buildEditState, ...partial },
    }));
  },

  markEditDirty: () => {
    set({ buildEditDirty: true });
  },

  clearEditDirty: () => {
    set({ buildEditDirty: false, editingCellKey: null });
  },

  initEditStateFromDraft: () => {
    set((s) => {
      const draft = s.buildDraft as Record<string, unknown> | null;
      if (!draft) return {};

      // Extract use cases from buildCellData
      const ucData = s.buildCellData['use-cases'];
      const useCases = (ucData?.items ?? []).map((title, i) => ({
        id: `uc-${i}`,
        title,
        category: 'general',
      }));

      // Extract review settings from buildCellData
      const reviewData = s.buildCellData['human-review'];
      const hasApproval = reviewData?.items?.some(
        (item) => item.toLowerCase().includes('required') || item.toLowerCase().includes('approval'),
      ) ?? false;

      // Extract memory settings
      const memoryData = s.buildCellData['memory'];
      const hasMemory = memoryData?.items?.some(
        (item) => !item.toLowerCase().includes('stateless') && !item.toLowerCase().includes('no memory'),
      ) ?? false;

      // Extract connectors from agent_ir
      const connectorMap: Record<string, string> = {};
      const connectors = draft.required_connectors;
      if (Array.isArray(connectors)) {
        for (const c of connectors) {
          const name = (c as Record<string, unknown>)?.name as string;
          const linked = s.buildConnectorLinks[name];
          if (name && linked) {
            connectorMap[name] = linked;
          }
        }
      }

      return {
        buildEditState: {
          connectorCredentialMap: connectorMap,
          connectorSwaps: {},
          triggerConfigs: {},
          requireApproval: hasApproval,
          autoApproveSeverity: hasApproval ? '' : 'all',
          reviewTimeout: hasApproval ? '24h' : 'none',
          memoryEnabled: hasMemory,
          memoryScope: hasMemory ? 'all' : '',
          messagePreset: 'updates',
          errorStrategy: 'retry-3x',
          useCases,
        },
        buildEditDirty: false,
        editingCellKey: null,
      };
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
      buildActivity: null,
      buildError: null,
      buildDraft: null,
      buildConnectorLinks: {},
      buildPendingAnswers: {},
      buildWorkflowJson: null,
      buildParserResultJson: null,
      buildWorkflowName: null,
      buildWorkflowPlatform: null,
      buildTestId: null,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
      buildToolTestResults: [],
      buildTestSummary: null,
      buildEditState: {
        connectorCredentialMap: {},
        connectorSwaps: {},
        triggerConfigs: {},
        requireApproval: false,
        autoApproveSeverity: '',
        reviewTimeout: '',
        memoryEnabled: false,
        memoryScope: '',
        messagePreset: '',
        errorStrategy: '',
        useCases: [],
      },
      buildEditDirty: false,
      editingCellKey: null,
    });
  },

  hydrateBuildSession: (session) => {
    // Build cell states AND cell data from resolvedCells
    const cellStates: Record<string, CellBuildStatus> = {};
    const cellData: Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }> = {};
    const resolvedCells = session.resolvedCells ?? {};
    for (const key of Object.keys(resolvedCells)) {
      cellStates[key] = "resolved";
      // Extract items/summary/raw from the resolved cell value
      const val = (resolvedCells as Record<string, unknown>)[key];
      if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        const items = Array.isArray(obj.items) ? obj.items.filter((i): i is string => typeof i === 'string') : undefined;
        const summary = typeof obj.summary === 'string' ? obj.summary : undefined;
        if (items || summary) {
          cellData[key] = { items, summary, raw: obj };
        }
      }
    }

    // Also check for highlighted cells from pending question
    if (session.pendingQuestion && typeof session.pendingQuestion === 'object') {
      const pq = session.pendingQuestion as unknown as Record<string, unknown>;
      const cellKey = (pq.cellKey ?? pq.cell_key) as string | undefined;
      if (cellKey) {
        cellStates[cellKey] = "highlighted";
      }
    }

    // Handle backward compat: backend sends single pendingQuestion (not array).
    // Wrap into array if present, empty array if null. Guard against malformed data.
    const pendingQuestions: BuildQuestion[] = [];
    if (session.pendingQuestion && typeof session.pendingQuestion === 'object') {
      const pq = session.pendingQuestion as unknown as Record<string, unknown>;
      if (pq.cell_key || pq.cellKey) {
        pendingQuestions.push({
          cellKey: (pq.cellKey ?? pq.cell_key) as string,
          question: (pq.question as string) ?? '',
          options: (pq.options as string[] | null) ?? null,
        });
      }
    }

    // Extract connector links from agentIr if present
    let connectorLinks: Record<string, string> = {};
    if (session.agentIr && typeof session.agentIr === 'object') {
      const ir = session.agentIr as Record<string, unknown>;
      if (ir.credential_links && typeof ir.credential_links === 'object') {
        connectorLinks = ir.credential_links as Record<string, string>;
      }
    }

    set({
      buildPersonaId: session.personaId,
      buildSessionId: session.id,
      buildPhase: session.phase,
      buildCellStates: cellStates,
      buildCellData: cellData,
      buildPendingQuestions: pendingQuestions,
      buildDraft: session.agentIr,
      buildError: session.errorMessage,
      buildConnectorLinks: connectorLinks,
    });
  },
});
