/**
 * Zustand slice for matrix build session state.
 *
 * ARCHITECTURE (after multi-draft refactor, 2026-04):
 *
 *   buildSessions: Record<sessionId, BuildSessionState>   ← source of truth
 *   activeBuildSessionId: string | null                    ← which draft the UI shows
 *   (scalar fields: buildPhase, buildCellData, ...)        ← mirror of active session
 *
 * Every mutation writes to `buildSessions[sessionId]` first, then `syncActive()`
 * mirrors the active session's state to the top-level scalars for backward
 * compatibility with existing selectors. When activeBuildSessionId changes, the
 * UI "switches drafts" by swapping which session's state is mirrored.
 *
 * Build state is persisted to SQLite (not localStorage) — hydration happens
 * via hydrateBuildSession().
 *
 * NEXT-ACTIVE-SESSION POLICY (removeBuildSession / resetBuildSession):
 * When the currently-active session is removed, we promote the remaining
 * session with the largest `createdAt` (most recently created draft) as the
 * new active session. Ties (equal createdAt) fall back to sessionId sort for
 * determinism. Previously this relied on `Object.keys(rest)[0]` — insertion
 * order — which was accidental. Callers that want a specific next session
 * should pass the id explicitly via a dedicated action (future work); today
 * the newest-first rule is the pinned default.
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
  PersonaBehaviorCore,
  CapabilityState,
  CapabilityDraft,
  PersonaResolution,
} from "@/lib/types/buildTypes";
import { isBuildPhase, isCellBuildStatus } from "@/lib/types/buildTypes";
import type { MatrixEditState } from "@/features/templates/sub_generated/gallery/matrix/matrixEditTypes";
import { storeBus } from "@/lib/storeBus";

// -- Per-session build state ------------------------------------------------

/**
 * Full state for a single draft build session. The store keeps a Record of
 * these keyed by sessionId. The active session's state is mirrored into the
 * top-level scalar fields on every mutation via syncActive().
 */
export interface BuildSessionState {
  personaId: string;
  sessionId: string;
  phase: BuildPhase;
  cellStates: Record<string, CellBuildStatus>;
  cellData: Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }>;
  pendingQuestions: BuildQuestion[];
  pendingAnswers: Record<string, string>;
  progress: number;
  outputLines: string[];
  activity: string | null;
  error: string | null;
  draft: unknown | null;
  connectorLinks: Record<string, string>;

  // Workflow import (per-session so different drafts can come from different imports)
  workflowJson: string | null;
  parserResultJson: string | null;
  workflowName: string | null;
  workflowPlatform: string | null;

  // Test lifecycle
  testId: string | null;
  testPassed: boolean | null;
  testOutputLines: string[];
  testError: string | null;
  toolTestResults: ToolTestResult[];
  testSummary: string | null;
  testConnectors: Array<{ name: string; has_credential: boolean }>;

  // Edit state
  editState: MatrixEditState;
  editDirty: boolean;
  editingCellKey: string | null;

  // v3 capability-framework state (additive; coexists with cellData)
  /** Phase A output — null until the CLI emits behavior_core_update. */
  behaviorCore: PersonaBehaviorCore | null;
  /** Phase B + Phase C output, keyed by capability id. */
  capabilities: Record<string, CapabilityState>;
  /** Display order for capabilities (preserves enumeration order + user additions). */
  capabilityOrder: string[];
  /** Persona-wide resolution fields (tools, connectors registry, defaults, ...). */
  personaResolution: PersonaResolution;
  /** v3 clarifying_question — scoped to mission, capability, field, or connector_category. */
  clarifyingQuestionV3: {
    scope: string;
    capability_id: string | null;
    field: string | null;
    question: string;
    options: string[] | null;
    category?: string | null;
  } | null;

  createdAt: number;
}

// -- Slice interface --------------------------------------------------------

export interface MatrixBuildSlice {
  // NEW: per-session state map (source of truth)
  buildSessions: Record<string, BuildSessionState>;
  activeBuildSessionId: string | null;

  // LEGACY scalars — automatically mirrored from buildSessions[activeBuildSessionId]
  // on every mutation. Existing selectors continue to read these unchanged.
  buildPersonaId: string | null;
  buildSessionId: string | null;
  buildPhase: BuildPhase;
  buildCellStates: Record<string, CellBuildStatus>;
  buildCellData: Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }>;
  buildPendingQuestions: BuildQuestion[];
  buildProgress: number;
  buildOutputLines: string[];
  buildActivity: string | null;
  buildError: string | null;
  buildDraft: unknown | null;
  buildConnectorLinks: Record<string, string>;
  buildWorkflowJson: string | null;
  buildParserResultJson: string | null;
  buildWorkflowName: string | null;
  buildWorkflowPlatform: string | null;
  buildPendingAnswers: Record<string, string>;
  buildTestId: string | null;
  buildTestPassed: boolean | null;
  buildTestOutputLines: string[];
  buildTestError: string | null;
  buildToolTestResults: ToolTestResult[];
  buildTestSummary: string | null;
  buildTestConnectors: Array<{ name: string; has_credential: boolean }>;
  buildEditState: MatrixEditState;
  buildEditDirty: boolean;
  editingCellKey: string | null;

  // v3 scalar mirrors of the active session's v3 state
  buildBehaviorCore: PersonaBehaviorCore | null;
  buildCapabilities: Record<string, CapabilityState>;
  buildCapabilityOrder: string[];
  buildPersonaResolution: PersonaResolution;
  buildClarifyingQuestionV3: {
    scope: string;
    capability_id: string | null;
    field: string | null;
    question: string;
    options: string[] | null;
  } | null;

  /** Read-only snapshot for MatrixTab viewing promoted agents. Isolated from
   * live build sessions so MatrixTab can't clobber an in-progress build. */
  savedBuildSnapshot: BuildSessionState | null;
  setSavedBuildSnapshot: (snap: BuildSessionState | null) => void;

  // Actions -- multi-draft management
  setActiveBuildSession: (sessionId: string | null) => void;
  /** Create a new empty session slot in the map and make it active. */
  createBuildSession: (personaId: string, sessionId: string) => void;
  /** Remove a session from the map (clears active if it was active). */
  removeBuildSession: (sessionId: string) => void;

  /** Apply a partial update to the currently active session.
   * Used by adoption/creation flows that need to patch phase/draft/etc.
   * without routing through an event handler. */
  patchActiveSession: (partial: Partial<BuildSessionState>) => void;

  // Actions -- event handlers (session-scoped when event.session_id provided)
  handleBuildCellUpdate: (event: Extract<BuildEvent, { type: "cell_update" }>) => void;
  handleBuildQuestion: (event: Extract<BuildEvent, { type: "question" }>) => void;
  handleBuildProgress: (event: Extract<BuildEvent, { type: "progress" }>) => void;
  handleBuildError: (event: Extract<BuildEvent, { type: "error" }>) => void;
  handleBuildSessionStatus: (event: Extract<BuildEvent, { type: "session_status" }>) => void;

  // v3 event handlers
  handleBehaviorCoreUpdate: (event: Extract<BuildEvent, { type: "behavior_core_update" }>) => void;
  handleCapabilityEnumerationUpdate: (
    event: Extract<BuildEvent, { type: "capability_enumeration_update" }>,
  ) => void;
  handleCapabilityResolutionUpdate: (
    event: Extract<BuildEvent, { type: "capability_resolution_update" }>,
  ) => void;
  handlePersonaResolutionUpdate: (
    event: Extract<BuildEvent, { type: "persona_resolution_update" }>,
  ) => void;
  handleClarifyingQuestionV3: (
    event: Extract<BuildEvent, { type: "clarifying_question_v3" }>,
  ) => void;

  // v3 editing actions — invoked by BehaviorCoreEditor / CapabilityRowEditor
  patchBehaviorCore: (partial: Partial<PersonaBehaviorCore>) => void;
  patchCapability: (id: string, partial: Partial<CapabilityState>) => void;
  addCapabilityDraft: (draft: CapabilityDraft) => void;
  removeCapability: (id: string) => void;
  clearClarifyingQuestionV3: () => void;

  // Actions -- question management
  clearBuildQuestion: (cellKey: string) => void;
  collectAnswer: (cellKey: string, answer: string) => void;
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

// -- Initial per-session state helpers --------------------------------------

const EMPTY_EDIT_STATE: MatrixEditState = {
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
};

function emptySessionState(personaId: string, sessionId: string): BuildSessionState {
  return {
    personaId,
    sessionId,
    phase: "initializing",
    cellStates: {},
    cellData: {},
    pendingQuestions: [],
    pendingAnswers: {},
    progress: 0,
    outputLines: [],
    activity: null,
    error: null,
    draft: null,
    connectorLinks: {},
    workflowJson: null,
    parserResultJson: null,
    workflowName: null,
    workflowPlatform: null,
    testId: null,
    testPassed: null,
    testOutputLines: [],
    testError: null,
    toolTestResults: [],
    testSummary: null,
    testConnectors: [],
    editState: { ...EMPTY_EDIT_STATE },
    editDirty: false,
    editingCellKey: null,
    behaviorCore: null,
    capabilities: {},
    capabilityOrder: [],
    personaResolution: {},
    clarifyingQuestionV3: null,
    createdAt: Date.now(),
  };
}

/**
 * Project a BuildSessionState onto the top-level scalar fields.
 * Called after every mutation that touches buildSessions or activeBuildSessionId
 * so existing selectors (which read the scalars) stay in sync.
 */
function scalarsFromSession(s: BuildSessionState | null): Pick<MatrixBuildSlice,
  | 'buildPersonaId' | 'buildSessionId' | 'buildPhase' | 'buildCellStates' | 'buildCellData'
  | 'buildPendingQuestions' | 'buildProgress' | 'buildOutputLines' | 'buildActivity'
  | 'buildError' | 'buildDraft' | 'buildConnectorLinks' | 'buildWorkflowJson'
  | 'buildParserResultJson' | 'buildWorkflowName' | 'buildWorkflowPlatform'
  | 'buildPendingAnswers' | 'buildTestId' | 'buildTestPassed' | 'buildTestOutputLines'
  | 'buildTestError' | 'buildToolTestResults' | 'buildTestSummary' | 'buildTestConnectors'
  | 'buildEditState' | 'buildEditDirty' | 'editingCellKey'
  | 'buildBehaviorCore' | 'buildCapabilities' | 'buildCapabilityOrder'
  | 'buildPersonaResolution' | 'buildClarifyingQuestionV3'> {
  if (!s) {
    return {
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
      buildPendingAnswers: {},
      buildTestId: null,
      buildTestPassed: null,
      buildTestOutputLines: [],
      buildTestError: null,
      buildToolTestResults: [],
      buildTestSummary: null,
      buildTestConnectors: [],
      buildEditState: { ...EMPTY_EDIT_STATE },
      buildEditDirty: false,
      editingCellKey: null,
      buildBehaviorCore: null,
      buildCapabilities: {},
      buildCapabilityOrder: [],
      buildPersonaResolution: {},
      buildClarifyingQuestionV3: null,
    };
  }
  return {
    buildPersonaId: s.personaId,
    buildSessionId: s.sessionId,
    buildPhase: s.phase,
    buildCellStates: s.cellStates,
    buildCellData: s.cellData,
    buildPendingQuestions: s.pendingQuestions,
    buildProgress: s.progress,
    buildOutputLines: s.outputLines,
    buildActivity: s.activity,
    buildError: s.error,
    buildDraft: s.draft,
    buildConnectorLinks: s.connectorLinks,
    buildWorkflowJson: s.workflowJson,
    buildParserResultJson: s.parserResultJson,
    buildWorkflowName: s.workflowName,
    buildWorkflowPlatform: s.workflowPlatform,
    buildPendingAnswers: s.pendingAnswers,
    buildTestId: s.testId,
    buildTestPassed: s.testPassed,
    buildTestOutputLines: s.testOutputLines,
    buildTestError: s.testError,
    buildToolTestResults: s.toolTestResults,
    buildTestSummary: s.testSummary,
    buildTestConnectors: s.testConnectors,
    buildEditState: s.editState,
    buildEditDirty: s.editDirty,
    editingCellKey: s.editingCellKey,
    buildBehaviorCore: s.behaviorCore,
    buildCapabilities: s.capabilities,
    buildCapabilityOrder: s.capabilityOrder,
    buildPersonaResolution: s.personaResolution,
    buildClarifyingQuestionV3: s.clarifyingQuestionV3,
  };
}

/**
 * Pure update helper: given the current state and an updater for a specific
 * session, return the state patch that updates buildSessions AND mirrors the
 * active session's scalars. If sessionId is null/undefined, falls back to the
 * active session.
 */
/**
 * Pin the "next active session" policy when the current active session is
 * removed: pick the remaining session with the newest createdAt, breaking
 * ties by sessionId (lexicographic) for determinism. Returns null when no
 * sessions remain.
 */
function pickNextActiveSessionId(
  sessions: Record<string, BuildSessionState>,
): string | null {
  const ids = Object.keys(sessions);
  if (ids.length === 0) return null;
  ids.sort((a, b) => {
    const ca = sessions[a]?.createdAt ?? 0;
    const cb = sessions[b]?.createdAt ?? 0;
    const diff = cb - ca;
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return ids[0] ?? null;
}

function updateSessionInState(
  state: MatrixBuildSlice,
  sessionId: string | null | undefined,
  updater: (s: BuildSessionState) => BuildSessionState,
): Partial<MatrixBuildSlice> {
  const targetId = sessionId ?? state.activeBuildSessionId;
  if (!targetId) return {};
  const existing = state.buildSessions[targetId];
  if (!existing) return {};
  const updated = updater(existing);
  const nextSessions = { ...state.buildSessions, [targetId]: updated };
  const activeSession = targetId === state.activeBuildSessionId ? updated : state.buildSessions[state.activeBuildSessionId ?? ''] ?? null;
  return {
    buildSessions: nextSessions,
    ...(targetId === state.activeBuildSessionId ? scalarsFromSession(activeSession) : {}),
  };
}

// -- Slice creator ----------------------------------------------------------

export const createMatrixBuildSlice: StateCreator<
  AgentStore,
  [],
  [],
  MatrixBuildSlice
> = (set, get) => ({
  // -- Initial state --------------------------------------------------------

  buildSessions: {},
  activeBuildSessionId: null,

  // Legacy scalar defaults (mirrored from active session; null until a session is created)
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
  buildPendingAnswers: {},
  buildTestId: null,
  buildTestPassed: null,
  buildTestOutputLines: [],
  buildTestError: null,
  buildToolTestResults: [],
  buildTestSummary: null,
  buildTestConnectors: [],
  buildEditState: { ...EMPTY_EDIT_STATE },
  buildEditDirty: false,
  editingCellKey: null,

  buildBehaviorCore: null,
  buildCapabilities: {},
  buildCapabilityOrder: [],
  buildPersonaResolution: {},
  buildClarifyingQuestionV3: null,

  savedBuildSnapshot: null,

  // -- Multi-draft management -----------------------------------------------

  setSavedBuildSnapshot: (snap) => set({ savedBuildSnapshot: snap }),

  setActiveBuildSession: (sessionId) => {
    set((state) => {
      if (sessionId === state.activeBuildSessionId) return {};
      const nextActive = sessionId ? state.buildSessions[sessionId] ?? null : null;
      return {
        activeBuildSessionId: sessionId,
        ...scalarsFromSession(nextActive),
      };
    });
  },

  createBuildSession: (personaId, sessionId) => {
    set((state) => {
      // If a session already exists with this id, just activate it
      if (state.buildSessions[sessionId]) {
        return {
          activeBuildSessionId: sessionId,
          ...scalarsFromSession(state.buildSessions[sessionId]),
        };
      }
      const newSession = emptySessionState(personaId, sessionId);
      const nextSessions = { ...state.buildSessions, [sessionId]: newSession };
      return {
        buildSessions: nextSessions,
        activeBuildSessionId: sessionId,
        ...scalarsFromSession(newSession),
      };
    });
  },

  removeBuildSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.buildSessions;
      const wasActive = state.activeBuildSessionId === sessionId;
      const nextActiveId = wasActive ? pickNextActiveSessionId(rest) : state.activeBuildSessionId;
      const nextActive = nextActiveId ? rest[nextActiveId] ?? null : null;
      return {
        buildSessions: rest,
        activeBuildSessionId: nextActiveId,
        ...(wasActive ? scalarsFromSession(nextActive) : {}),
      };
    });
  },

  patchActiveSession: (partial) => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, ...partial })));
  },

  // -- Event handlers -------------------------------------------------------
  // Events carry `session_id`; handlers dispatch to that session in the map.

  handleBuildCellUpdate: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      // agent_ir arrival: store in draft (plus update persona name in personas list separately)
      if (event.cell_key === "agent_ir") {
        const data = typeof event.data === 'string'
          ? (() => { try { return JSON.parse(event.data as string); } catch { return event.data; } })()
          : event.data;
        const irName = data && typeof data === 'object' ? (data as Record<string, unknown>).name : undefined;
        if (typeof irName === 'string' && irName.length > 0) {
          // Update persona name in the top-level personas list via set side-effect
          queueMicrotask(() => {
            const cur = get();
            if (cur.personas.some(p => p.id === sess.personaId && p.name !== irName)) {
              set({ personas: cur.personas.map(p => p.id === sess.personaId ? { ...p, name: irName } : p) });
            }
          });
        }
        return { ...sess, draft: data };
      }

      // Parse structured cell payload
      const cellData = { ...sess.cellData };
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>;
          const items = obj.items as string[] | undefined;
          const summary = obj.summary as string | undefined;
          cellData[event.cell_key] = { items, summary, raw: obj };
        }
      } catch { /* ignore parse errors */ }

      const prevStatus = sess.cellStates[event.cell_key];
      // Validate against the CellBuildStatus union. Backend drift (rename or
      // new variant) would previously slip through as-is and corrupt state;
      // fall back to 'error' with a log so the issue is visible.
      let incomingStatus: CellBuildStatus;
      if (isCellBuildStatus(event.status)) {
        incomingStatus = event.status;
      } else {
        console.warn('[matrixBuildSlice] Unknown cell build status, falling back to "error"', {
          received: event.status,
          cell: event.cell_key,
        });
        incomingStatus = 'error';
      }
      let newStatus: CellBuildStatus;
      if (prevStatus === incomingStatus && prevStatus === 'resolved') {
        const oldItems = sess.cellData[event.cell_key]?.items;
        const newData = typeof event.data === 'string'
          ? (() => { try { return JSON.parse(event.data as string); } catch { return null; } })()
          : event.data;
        const newItems = (newData as Record<string, unknown> | null)?.items;
        const dataChanged = JSON.stringify(oldItems) !== JSON.stringify(newItems);
        newStatus = dataChanged ? 'updated' : 'resolved';
      } else {
        newStatus = incomingStatus;
      }

      return {
        ...sess,
        cellStates: { ...sess.cellStates, [event.cell_key]: newStatus },
        cellData,
      };
    }));
  },

  handleBuildQuestion: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const filtered = sess.pendingQuestions.filter((q) => q.cellKey !== event.cell_key);
      return {
        ...sess,
        pendingQuestions: [
          ...filtered,
          {
            cellKey: event.cell_key,
            question: event.question,
            options: event.options,
            // Preserve the connector_category hint from v3 clarifying_question
            // mirroring so the UI can route to the vault picker.
            connectorCategory: event.connector_category ?? null,
          },
        ],
        cellStates: { ...sess.cellStates, [event.cell_key]: "highlighted" },
        phase: "awaiting_input",
      };
    }));
  },

  handleBuildProgress: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const nextLines = [...sess.outputLines, event.message];
      const trimmed = nextLines.length > MAX_OUTPUT_LINES
        ? nextLines.slice(nextLines.length - MAX_OUTPUT_LINES)
        : nextLines;
      return {
        ...sess,
        outputLines: trimmed,
        activity: event.activity ?? sess.activity,
        ...(event.percent != null ? { progress: event.percent } : {}),
      };
    }));
  },

  handleBuildError: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => ({
      ...sess,
      error: event.message,
      phase: "failed",
    })));
  },

  handleBuildSessionStatus: (event) => {
    const progress = event.total_count > 0
      ? (event.resolved_count / event.total_count) * 100
      : 0;
    // Validate the phase string against the known union. Backend drift
    // falls back to 'failed' with a log instead of silently corrupting
    // session state.
    let phase: BuildPhase;
    if (isBuildPhase(event.phase)) {
      phase = event.phase;
    } else {
      console.warn('[matrixBuildSlice] Unknown build phase, falling back to "failed"', {
        received: event.phase,
      });
      phase = 'failed';
    }
    set((state) => {
      const patch = updateSessionInState(state, event.session_id, (sess) => {
        storeBus.emit('build:phase-changed', { phase, personaId: sess.personaId });
        return { ...sess, phase, progress };
      });
      return patch;
    });
  },

  // -- v3 event handlers ----------------------------------------------------

  handleBehaviorCoreUpdate: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const data = (event.data ?? {}) as Partial<PersonaBehaviorCore>;
      const prev = sess.behaviorCore ?? {
        mission: '',
        identity: { role: '', description: '' },
        voice: { style: '', output_format: '' },
        principles: [],
        constraints: [],
      };
      return {
        ...sess,
        behaviorCore: {
          ...prev,
          ...data,
          identity: { ...prev.identity, ...(data.identity ?? {}) },
          voice: { ...prev.voice, ...(data.voice ?? {}) },
          principles: data.principles ?? prev.principles,
          constraints: data.constraints ?? prev.constraints,
          decision_principles: data.decision_principles ?? prev.decision_principles,
          verbosity_default: data.verbosity_default ?? prev.verbosity_default,
        },
      };
    }));
  },

  handleCapabilityEnumerationUpdate: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const payload = (event.data ?? {}) as { capabilities?: CapabilityDraft[] };
      const drafts = payload.capabilities ?? [];
      const nextCaps: Record<string, CapabilityState> = { ...sess.capabilities };
      const nextOrder: string[] = [...sess.capabilityOrder];
      for (const d of drafts) {
        if (!d?.id) continue;
        if (!nextCaps[d.id]) {
          nextCaps[d.id] = {
            id: d.id,
            title: d.title ?? d.id,
            capability_summary: d.capability_summary ?? '',
            user_facing_goal: d.user_facing_goal,
            enabled_by_default: true,
            resolvedFields: {},
          };
          nextOrder.push(d.id);
        } else {
          // Merge draft metadata (LLM may refine title/summary during a clarifying_question flow)
          const existing = nextCaps[d.id]!;
          nextCaps[d.id] = {
            ...existing,
            title: d.title ?? existing.title,
            capability_summary: d.capability_summary ?? existing.capability_summary,
            user_facing_goal: d.user_facing_goal ?? existing.user_facing_goal,
          };
        }
      }
      return {
        ...sess,
        capabilities: nextCaps,
        capabilityOrder: nextOrder,
      };
    }));
  },

  handleCapabilityResolutionUpdate: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const { capability_id, field, value, status } = event;
      if (!capability_id || !field) return sess;
      const existing = sess.capabilities[capability_id];
      // If the LLM resolves a field for an id we haven't seen in enumeration,
      // create a stub capability so nothing gets lost.
      const cap: CapabilityState = existing ?? {
        id: capability_id,
        title: capability_id,
        capability_summary: '',
        enabled_by_default: true,
        resolvedFields: {},
      };
      const updated: CapabilityState = {
        ...cap,
        [field]: value,
        resolvedFields: { ...cap.resolvedFields, [field]: status === 'resolved' ? 'resolved' : 'pending' },
      };
      const nextOrder = existing ? sess.capabilityOrder : [...sess.capabilityOrder, capability_id];
      return {
        ...sess,
        capabilities: { ...sess.capabilities, [capability_id]: updated },
        capabilityOrder: nextOrder,
      };
    }));
  },

  handlePersonaResolutionUpdate: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => {
      const { field, value } = event;
      if (!field) return sess;
      return {
        ...sess,
        personaResolution: { ...sess.personaResolution, [field]: value },
      };
    }));
  },

  handleClarifyingQuestionV3: (event) => {
    set((state) => updateSessionInState(state, event.session_id, (sess) => ({
      ...sess,
      clarifyingQuestionV3: {
        scope: event.scope,
        capability_id: event.capability_id,
        field: event.field,
        question: event.question,
        options: event.options,
        category: event.category ?? null,
      },
      phase: 'awaiting_input',
    })));
  },

  // -- v3 editing actions ---------------------------------------------------

  patchBehaviorCore: (partial) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      const prev = sess.behaviorCore ?? {
        mission: '',
        identity: { role: '', description: '' },
        voice: { style: '', output_format: '' },
        principles: [],
        constraints: [],
      };
      return {
        ...sess,
        behaviorCore: {
          ...prev,
          ...partial,
          identity: { ...prev.identity, ...(partial.identity ?? {}) },
          voice: { ...prev.voice, ...(partial.voice ?? {}) },
        },
        editDirty: true,
      };
    }));
  },

  patchCapability: (id, partial) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      const cap = sess.capabilities[id];
      if (!cap) return sess;
      return {
        ...sess,
        capabilities: { ...sess.capabilities, [id]: { ...cap, ...partial } },
        editDirty: true,
      };
    }));
  },

  addCapabilityDraft: (draft) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      // Disambiguate colliding ids by appending _2, _3, ... rather than
      // silently dropping the new draft (which would clobber user work).
      let id = draft.id;
      if (sess.capabilities[id]) {
        let suffix = 2;
        while (sess.capabilities[`${draft.id}_${suffix}`]) suffix += 1;
        id = `${draft.id}_${suffix}`;
      }
      const cap: CapabilityState = {
        id,
        title: draft.title,
        capability_summary: draft.capability_summary,
        user_facing_goal: draft.user_facing_goal,
        enabled_by_default: true,
        resolvedFields: {},
      };
      return {
        ...sess,
        capabilities: { ...sess.capabilities, [id]: cap },
        capabilityOrder: [...sess.capabilityOrder, id],
        editDirty: true,
      };
    }));
  },

  removeCapability: (id) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      if (!sess.capabilities[id]) return sess;
      const { [id]: _removed, ...rest } = sess.capabilities;
      return {
        ...sess,
        capabilities: rest,
        capabilityOrder: sess.capabilityOrder.filter((x) => x !== id),
        editDirty: true,
      };
    }));
  },

  clearClarifyingQuestionV3: () => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      clarifyingQuestionV3: null,
    })));
  },

  // -- Test lifecycle actions ------------------------------------------------

  handleStartTest: (testId) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      phase: "testing",
      testId,
      testPassed: null,
      testOutputLines: [],
      testError: null,
    })));
  },

  handleTestComplete: (passed, outputPreview) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      storeBus.emit('build:phase-changed', { phase: 'test_complete', personaId: sess.personaId });
      return {
        ...sess,
        phase: "test_complete" as BuildPhase,
        testPassed: passed,
        testOutputLines: [outputPreview],
      };
    }));
  },

  handleTestFailed: (error) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      phase: "test_complete",
      testPassed: false,
      testError: error,
    })));
  },

  handleRejectTest: () => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      phase: "draft_ready",
      testId: null,
      testPassed: null,
      testOutputLines: [],
      testError: null,
      toolTestResults: [],
      testSummary: null,
    })));
  },

  appendTestOutput: (line) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      const nextLines = [...sess.testOutputLines, line];
      const trimmed = nextLines.length > MAX_TEST_OUTPUT_LINES
        ? nextLines.slice(nextLines.length - MAX_TEST_OUTPUT_LINES)
        : nextLines;
      return { ...sess, testOutputLines: trimmed };
    }));
  },

  setToolTestResults: (results) => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, toolTestResults: results })));
  },

  appendToolTestResult: (result) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      toolTestResults: [...sess.toolTestResults, result],
    })));
  },

  setTestSummary: (summary) => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, testSummary: summary })));
  },

  setTestConnectors: (connectors) => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, testConnectors: connectors })));
  },

  // -- Question management --------------------------------------------------

  clearBuildQuestion: (cellKey) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      pendingQuestions: sess.pendingQuestions.filter((q) => q.cellKey !== cellKey),
    })));
  },

  collectAnswer: (cellKey, answer) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      pendingAnswers: { ...sess.pendingAnswers, [cellKey]: answer },
      cellStates: { ...sess.cellStates, [cellKey]: 'filling' },
      pendingQuestions: sess.pendingQuestions.filter((q) => q.cellKey !== cellKey),
    })));
  },

  clearPendingAnswers: () => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, pendingAnswers: {} })));
  },

  // -- Cell update confirmation -----------------------------------------------

  confirmCellUpdate: (cellKey) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      cellStates: { ...sess.cellStates, [cellKey]: "resolved" },
    })));
  },

  // -- Connector link management --------------------------------------------

  linkBuildConnector: (connectorName, credentialId) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      connectorLinks: { ...sess.connectorLinks, [connectorName]: credentialId },
    })));
  },

  unlinkBuildConnector: (connectorName) => {
    set((state) => updateSessionInState(state, null, (sess) => {
      const next = { ...sess.connectorLinks };
      delete next[connectorName];
      return { ...sess, connectorLinks: next };
    }));
  },

  // -- Workflow import management ------------------------------------------

  setWorkflowImport: (params) => {
    set((state) => {
      // Workflow import can be set BEFORE a session exists (user uploads a file
      // before clicking build). If no active session, store at top level only.
      if (!state.activeBuildSessionId) {
        return {
          buildWorkflowJson: params.workflowJson,
          buildParserResultJson: params.parserResultJson,
          buildWorkflowName: params.name,
          buildWorkflowPlatform: params.platform,
        };
      }
      return updateSessionInState(state, null, (sess) => ({
        ...sess,
        workflowJson: params.workflowJson,
        parserResultJson: params.parserResultJson,
        workflowName: params.name,
        workflowPlatform: params.platform,
      }));
    });
  },

  clearWorkflowImport: () => {
    set((state) => {
      if (!state.activeBuildSessionId) {
        return {
          buildWorkflowJson: null,
          buildParserResultJson: null,
          buildWorkflowName: null,
          buildWorkflowPlatform: null,
        };
      }
      return updateSessionInState(state, null, (sess) => ({
        ...sess,
        workflowJson: null,
        parserResultJson: null,
        workflowName: null,
        workflowPlatform: null,
      }));
    });
  },

  // -- Inline editing actions -----------------------------------------------

  setEditingCell: (cellKey) => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, editingCellKey: cellKey })));
  },

  updateEditState: (partial) => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      editState: { ...sess.editState, ...partial },
    })));
  },

  markEditDirty: () => {
    set((state) => updateSessionInState(state, null, (sess) => ({ ...sess, editDirty: true })));
  },

  clearEditDirty: () => {
    set((state) => updateSessionInState(state, null, (sess) => ({
      ...sess,
      editDirty: false,
      editingCellKey: null,
    })));
  },

  initEditStateFromDraft: () => {
    set((state) => updateSessionInState(state, null, (sess) => {
      const draft = sess.draft as Record<string, unknown> | null;
      if (!draft) return sess;

      const ucData = sess.cellData['use-cases'];
      const useCases = (ucData?.items ?? []).map((title, i) => ({
        id: `uc-${i}`,
        title,
        category: 'general',
      }));

      // CONTRACT: Edit state derives from structured IR fields, never from
      // display strings. Keyword matching on cellData items is English-only,
      // fragile (e.g. a 'not required' item containing 'required' would flip
      // the flag), and breaks localization across the app's 14 languages.
      const useCasesIR = Array.isArray(draft.use_cases)
        ? (draft.use_cases as Array<Record<string, unknown>>)
        : [];

      const hasApproval = useCasesIR.some((uc) => {
        const policy = uc.review_policy as { mode?: string } | undefined;
        return policy?.mode === 'on_low_confidence' || policy?.mode === 'always';
      }) || Object.values(sess.capabilities).some((cap) => {
        const mode = cap.review_policy?.mode;
        return mode === 'on_low_confidence' || mode === 'always';
      });

      const hasMemory = useCasesIR.some((uc) => {
        const policy = uc.memory_policy as { enabled?: boolean } | undefined;
        return policy?.enabled === true;
      }) || Object.values(sess.capabilities).some((cap) => cap.memory_policy?.enabled === true);

      const connectorMap: Record<string, string> = {};
      const connectors = draft.required_connectors;
      if (Array.isArray(connectors)) {
        for (const c of connectors) {
          const name = (c as Record<string, unknown>)?.name as string;
          const linked = sess.connectorLinks[name];
          if (name && linked) connectorMap[name] = linked;
        }
      }

      return {
        ...sess,
        editState: {
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
        editDirty: false,
        editingCellKey: null,
      };
    }));
  },

  // -- Lifecycle actions ----------------------------------------------------

  /**
   * Reset the CURRENT active session. For multi-draft this only clears the
   * active session from the map (other drafts are preserved). If no session
   * is active, clears only the top-level scalars.
   */
  resetBuildSession: () => {
    set((state) => {
      const activeId = state.activeBuildSessionId;
      if (!activeId) {
        return scalarsFromSession(null);
      }
      const { [activeId]: _removed, ...rest } = state.buildSessions;
      // Promote another session to active if available, otherwise clear.
      // Policy: newest createdAt wins (see header). No more accidental
      // insertion-order selection.
      const nextActiveId = pickNextActiveSessionId(rest);
      const nextActive = nextActiveId ? rest[nextActiveId] ?? null : null;
      return {
        buildSessions: rest,
        activeBuildSessionId: nextActiveId,
        ...scalarsFromSession(nextActive),
      };
    });
  },

  hydrateBuildSession: (session) => {
    // Build cell states AND cell data from resolvedCells
    const cellStates: Record<string, CellBuildStatus> = {};
    const cellData: Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }> = {};
    const resolvedCells = session.resolvedCells ?? {};
    for (const key of Object.keys(resolvedCells)) {
      cellStates[key] = "resolved";
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

    if (session.pendingQuestion && typeof session.pendingQuestion === 'object') {
      const pq = session.pendingQuestion as unknown as Record<string, unknown>;
      const cellKey = (pq.cellKey ?? pq.cell_key) as string | undefined;
      if (cellKey) cellStates[cellKey] = "highlighted";
    }

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

    let connectorLinks: Record<string, string> = {};
    if (session.agentIr && typeof session.agentIr === 'object') {
      const ir = session.agentIr as Record<string, unknown>;
      if (ir.credential_links && typeof ir.credential_links === 'object') {
        connectorLinks = ir.credential_links as Record<string, string>;
      }
    }

    // v3: if the stored agent_ir carries a persona block + use_cases, hydrate
    // the v3 state too so the capability-first UI can resume an in-progress
    // session after a page reload.
    let behaviorCore: PersonaBehaviorCore | null = null;
    const capabilities: Record<string, CapabilityState> = {};
    const capabilityOrder: string[] = [];
    let personaResolution: PersonaResolution = {};
    if (session.agentIr && typeof session.agentIr === 'object') {
      const ir = session.agentIr as Record<string, unknown>;
      const persona = ir.persona as Record<string, unknown> | undefined;
      if (persona) {
        behaviorCore = {
          mission: (persona.mission as string) ?? '',
          identity: (persona.identity as PersonaBehaviorCore['identity']) ?? { role: '', description: '' },
          voice: (persona.voice as PersonaBehaviorCore['voice']) ?? { style: '', output_format: '' },
          principles: (persona.principles as string[]) ?? [],
          constraints: (persona.constraints as string[]) ?? [],
          decision_principles: persona.decision_principles as string[] | undefined,
          verbosity_default: persona.verbosity_default as PersonaBehaviorCore['verbosity_default'],
        };
        personaResolution = {
          tools: persona.tools as PersonaResolution['tools'],
          connectors: persona.connectors as PersonaResolution['connectors'],
          notification_channels_default: persona.notification_channels_default as PersonaResolution['notification_channels_default'],
          operating_instructions: persona.operating_instructions as string | undefined,
          tool_guidance: persona.tool_guidance as string | undefined,
          error_handling: persona.error_handling as string | undefined,
          core_memories: persona.core_memories as PersonaResolution['core_memories'],
        };
      }
      const useCases = ir.use_cases as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(useCases)) {
        for (const uc of useCases) {
          const id = uc.id as string | undefined;
          if (!id) continue;
          capabilities[id] = {
            id,
            title: (uc.title as string) ?? id,
            capability_summary: (uc.capability_summary as string) ?? (uc.description as string) ?? '',
            user_facing_goal: uc.user_facing_goal as string | undefined,
            enabled_by_default: (uc.enabled_by_default as boolean) ?? true,
            suggested_trigger: uc.suggested_trigger as CapabilityState['suggested_trigger'],
            connectors: uc.connectors as string[] | undefined,
            notification_channels: uc.notification_channels as CapabilityState['notification_channels'],
            review_policy: uc.review_policy as CapabilityState['review_policy'],
            memory_policy: uc.memory_policy as CapabilityState['memory_policy'],
            event_subscriptions: uc.event_subscriptions as CapabilityState['event_subscriptions'],
            input_schema: uc.input_schema as CapabilityState['input_schema'],
            sample_input: uc.sample_input as Record<string, unknown> | undefined,
            tool_hints: uc.tool_hints as string[] | undefined,
            use_case_flow: uc.use_case_flow as CapabilityState['use_case_flow'],
            error_handling: uc.error_handling as string | undefined,
            resolvedFields: {},
          };
          capabilityOrder.push(id);
        }
      }
    }

    set((state) => {
      // Create (or replace) the session in the map, and make it active
      const hydrated: BuildSessionState = {
        ...emptySessionState(session.personaId, session.id),
        phase: session.phase,
        cellStates,
        cellData,
        pendingQuestions,
        draft: session.agentIr,
        error: session.errorMessage ?? null,
        connectorLinks,
        behaviorCore,
        capabilities,
        capabilityOrder,
        personaResolution,
        // Carry over any pending workflow import from top-level scalars if present
        // (user may have uploaded a workflow before hydration arrived)
        workflowJson: state.buildWorkflowJson,
        parserResultJson: state.buildParserResultJson,
        workflowName: state.buildWorkflowName,
        workflowPlatform: state.buildWorkflowPlatform,
      };
      const nextSessions = { ...state.buildSessions, [session.id]: hydrated };
      return {
        buildSessions: nextSessions,
        activeBuildSessionId: session.id,
        ...scalarsFromSession(hydrated),
      };
    });
  },
});
