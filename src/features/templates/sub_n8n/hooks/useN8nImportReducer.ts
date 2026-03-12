import { useReducer, useCallback } from 'react';
import type { N8nPersonaDraft, StreamingSection } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { WorkflowPlatform } from '@/lib/personas/parsers/workflowDetector';
import {
  navigationReducer,
  checkStepPrecondition,
  INITIAL_NAVIGATION,
} from '../reducers/navigationReducer';
import {
  transformReducer,
  INITIAL_TRANSFORM,
} from '../reducers/transformReducer';
import {
  testReducer,
  INITIAL_TEST,
} from '../reducers/testReducer';
import {
  sessionReducer,
  initSelectionsFromResult,
  INITIAL_SESSION,
} from '../reducers/sessionReducer';

// -- Wizard Steps --

export type N8nWizardStep = 'upload' | 'analyze' | 'transform' | 'edit' | 'confirm';

export const WIZARD_STEPS: readonly N8nWizardStep[] = [
  'upload',
  'analyze',
  'transform',
  'edit',
  'confirm',
] as const;

export const STEP_META: Record<N8nWizardStep, { label: string; index: number }> = {
  upload:    { label: 'Detect',    index: 0 },
  analyze:   { label: 'Parse',     index: 1 },
  transform: { label: 'Transform', index: 2 },
  edit:      { label: 'Optimize',  index: 3 },
  confirm:   { label: 'Link',      index: 4 },
};

// -- Transform Sub-Phases --

export type TransformSubPhase = 'idle' | 'asking' | 'answering' | 'generating' | 'completed' | 'failed';

// -- Transform Questions --

export interface TransformQuestion {
  id: string;
  category?: string;
  question: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
}

// -- State --

export interface N8nImportState {
  step: N8nWizardStep;

  // Session persistence
  sessionId: string | null;

  // Upload
  rawWorkflowJson: string;
  workflowName: string;
  /** Detected source platform (n8n, zapier, make, github-actions) */
  platform: WorkflowPlatform;
  error: string | null;
  sessionWarning: string | null;

  // Parse / Analyze
  parsedResult: AgentIR | null;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;

  // Configure (pre-transform questions) -- now inline within transform step
  questions: TransformQuestion[] | null;
  userAnswers: Record<string, string>;

  // Transform sub-phase tracking
  transformSubPhase: TransformSubPhase;

  // Transform
  transforming: boolean;
  backgroundTransformId: string | null;
  /** Incremented each time polling should restart (e.g. Turn 2 after answers). */
  snapshotEpoch: number;
  adjustmentRequest: string;
  transformPhase: CliRunPhase;
  transformLines: string[];

  // Draft
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;

  // Streaming sections (section-by-section transform)
  streamingSections: StreamingSection[];

  // Draft validation / streaming test
  testStatus: 'idle' | 'running' | 'passed' | 'failed';
  testError: string | null;
  testRunId: string | null;
  testLines: string[];
  testPhase: CliRunPhase;

  // Confirm
  confirming: boolean;
  created: boolean;

  // Platform detection confidence
  platformNeedsConfirmation: boolean;
  detectedConfidence: 'high' | 'medium' | 'low';
}

const INITIAL_STATE: N8nImportState = {
  ...INITIAL_NAVIGATION,
  ...INITIAL_SESSION,
  ...INITIAL_TRANSFORM,
  ...INITIAL_TEST,
};

// -- Actions --

export type N8nImportAction =
  | { type: 'FILE_PARSED'; workflowName: string; rawWorkflowJson: string; parsedResult: AgentIR; platform?: WorkflowPlatform; needsConfirmation?: boolean; detectedConfidence?: 'high' | 'medium' | 'low' }
  | { type: 'CONFIRM_PLATFORM' }
  | { type: 'TOGGLE_TOOL'; index: number }
  | { type: 'TOGGLE_TRIGGER'; index: number }
  | { type: 'TOGGLE_CONNECTOR'; name: string }
  | { type: 'SET_ADJUSTMENT'; text: string }
  | { type: 'QUESTIONS_GENERATED'; questions: TransformQuestion[] }
  | { type: 'QUESTIONS_FAILED'; error: string }
  | { type: 'ANSWER_UPDATED'; questionId: string; answer: string }
  | { type: 'TRANSFORM_STARTED'; transformId: string; subPhase?: TransformSubPhase }
  | { type: 'TRANSFORM_LINES'; lines: string[] }
  | { type: 'TRANSFORM_PHASE'; phase: CliRunPhase }
  | { type: 'TRANSFORM_SECTIONS'; sections: StreamingSection[] }
  | { type: 'TRANSFORM_COMPLETED'; draft: N8nPersonaDraft }
  | { type: 'TRANSFORM_FAILED'; error: string }
  | { type: 'TRANSFORM_CANCELLED' }
  | { type: 'DRAFT_UPDATED'; draft: N8nPersonaDraft }
  | { type: 'DRAFT_JSON_EDITED'; json: string; draft: N8nPersonaDraft | null; error: string | null }
  | { type: 'CONFIRM_STARTED' }
  | { type: 'CONFIRM_COMPLETED' }
  | { type: 'CONFIRM_FAILED'; error: string }
  | { type: 'TEST_STREAM_STARTED'; testId: string }
  | { type: 'TEST_LINES'; lines: string[] }
  | { type: 'TEST_PHASE'; phase: CliRunPhase }
  | { type: 'TEST_STARTED' }
  | { type: 'TEST_PASSED' }
  | { type: 'TEST_FAILED'; error: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEAR_SESSION_WARNING' }
  | { type: 'GO_TO_STEP'; step: N8nWizardStep }
  | { type: 'RESTORE_CONTEXT'; workflowName: string; rawWorkflowJson: string; parsedResult: AgentIR | null; transformId: string }
  | { type: 'SESSION_CREATED'; sessionId: string }
  | { type: 'SESSION_LOADED'; payload: SessionLoadedPayload }
  | { type: 'RESET' };

/** Pre-computed payload for loading a saved session. Step routing and
 *  sub-phase inference are computed by the caller (N8nSessionList). */
export interface SessionLoadedPayload {
  sessionId: string;
  step: N8nWizardStep;
  workflowName: string;
  rawWorkflowJson: string;
  parsedResult: AgentIR | null;
  draft: N8nPersonaDraft | null;
  questions: TransformQuestion[] | null;
  transformId: string | null;
  userAnswers: Record<string, string>;
  transformSubPhase: TransformSubPhase;
  recoveryWarning?: string | null;
}

// -- Composed Reducer --
//
// Cross-cutting actions (RESET, SESSION_LOADED) are handled at the
// orchestrator level. Each sub-reducer manages its own state slice
// and responds to the actions it cares about. Sub-reducers receive
// the full previous state as a read-only parameter for cross-slice reads.

function n8nImportReducer(state: N8nImportState, action: N8nImportAction): N8nImportState {
  // Cross-cutting: full reset
  if (action.type === 'RESET') return INITIAL_STATE;

  // Cross-cutting: session restore hydrates all slices at once
  if (action.type === 'SESSION_LOADED') {
    return handleSessionLoaded(action.payload);
  }

  // Delegate to sub-reducers -- each handles its own slice
  const nav = navigationReducer({ step: state.step }, action, state);
  const transform = transformReducer({
    questions: state.questions,
    userAnswers: state.userAnswers,
    transformSubPhase: state.transformSubPhase,
    transforming: state.transforming,
    backgroundTransformId: state.backgroundTransformId,
    snapshotEpoch: state.snapshotEpoch,
    adjustmentRequest: state.adjustmentRequest,
    transformPhase: state.transformPhase,
    transformLines: state.transformLines,
    streamingSections: state.streamingSections,
    draft: state.draft,
    draftJson: state.draftJson,
    draftJsonError: state.draftJsonError,
  }, action);
  const test = testReducer({
    testStatus: state.testStatus,
    testError: state.testError,
    testRunId: state.testRunId,
    testLines: state.testLines,
    testPhase: state.testPhase,
  }, action);
  const session = sessionReducer({
    sessionId: state.sessionId,
    rawWorkflowJson: state.rawWorkflowJson,
    workflowName: state.workflowName,
    platform: state.platform,
    error: state.error,
    sessionWarning: state.sessionWarning,
    parsedResult: state.parsedResult,
    selectedToolIndices: state.selectedToolIndices,
    selectedTriggerIndices: state.selectedTriggerIndices,
    selectedConnectorNames: state.selectedConnectorNames,
    confirming: state.confirming,
    created: state.created,
    platformNeedsConfirmation: state.platformNeedsConfirmation,
    detectedConfidence: state.detectedConfidence,
  }, action, state);

  return {
    ...nav,
    ...session,
    ...transform,
    ...test,
  };
}

/** Handle SESSION_LOADED: hydrates all slices from the persisted payload. */
function handleSessionLoaded(p: SessionLoadedPayload): N8nImportState {
  const selections = p.parsedResult ? initSelectionsFromResult(p.parsedResult) : {};

  // Validate that the restored step's prerequisites are met;
  // fall back to the latest valid step if not.
  let safeStep = p.step;
  const restoredState = { parsedResult: p.parsedResult, draft: p.draft, draftJsonError: null };
  if (checkStepPrecondition(safeStep, restoredState)) {
    if (p.draft) safeStep = 'edit';
    else if (p.parsedResult) safeStep = 'analyze';
    else safeStep = 'upload';
  }

  return {
    ...INITIAL_STATE,
    sessionId: p.sessionId,
    step: safeStep,
    workflowName: p.workflowName,
    rawWorkflowJson: p.rawWorkflowJson,
    parsedResult: p.parsedResult,
    draft: p.draft,
    draftJson: p.draft ? JSON.stringify(p.draft, null, 2) : '',
    transformSubPhase: p.transformSubPhase,
    questions: p.questions,
    userAnswers: p.userAnswers,
    backgroundTransformId: p.transformId,
    sessionWarning: p.recoveryWarning ?? null,
    ...selections,
  };
}

// -- Hook --

export function useN8nImportReducer() {
  const [state, dispatch] = useReducer(n8nImportReducer, INITIAL_STATE);

  const canGoBack = state.step !== 'upload' && !state.transforming && !state.confirming && state.transformSubPhase !== 'asking';

  const goBack = useCallback(() => {
    if (!canGoBack) return;

    // From edit or transform -> go to analyze (skip transform since it's a live process step)
    if (state.step === 'edit' || state.step === 'transform') {
      dispatch({ type: 'GO_TO_STEP', step: 'analyze' });
      return;
    }

    const idx = STEP_META[state.step].index;
    if (idx <= 0) return;
    const prevStep = WIZARD_STEPS[idx - 1];
    if (prevStep) dispatch({ type: 'GO_TO_STEP', step: prevStep });
  }, [canGoBack, state.step]);

  return { state, dispatch, canGoBack, goBack };
}
