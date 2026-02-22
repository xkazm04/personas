import { useReducer, useCallback } from 'react';
import type { N8nPersonaDraft } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

// ── Wizard Steps ──

export type N8nWizardStep = 'upload' | 'analyze' | 'transform' | 'edit' | 'confirm';

export const WIZARD_STEPS: readonly N8nWizardStep[] = [
  'upload',
  'analyze',
  'transform',
  'edit',
  'confirm',
] as const;

export const STEP_META: Record<N8nWizardStep, { label: string; index: number }> = {
  upload:    { label: 'Upload',    index: 0 },
  analyze:   { label: 'Analyze',   index: 1 },
  transform: { label: 'Transform', index: 2 },
  edit:      { label: 'Edit',      index: 3 },
  confirm:   { label: 'Confirm',   index: 4 },
};

// ── Transform Sub-Phases ──

export type TransformSubPhase = 'idle' | 'asking' | 'answering' | 'generating' | 'completed' | 'failed';

// ── Transform Questions ──

export interface TransformQuestion {
  id: string;
  question: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
}

// ── State ──

export interface N8nImportState {
  step: N8nWizardStep;

  // Session persistence
  sessionId: string | null;

  // Upload
  rawWorkflowJson: string;
  workflowName: string;
  error: string | null;

  // Parse / Analyze
  parsedResult: DesignAnalysisResult | null;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;

  // Configure (pre-transform questions) — now inline within transform step
  questions: TransformQuestion[] | null;
  userAnswers: Record<string, string>;
  questionsSkipped: boolean;

  // Transform sub-phase tracking
  transformSubPhase: TransformSubPhase;

  // Transform
  transforming: boolean;
  backgroundTransformId: string | null;
  adjustmentRequest: string;
  transformPhase: CliRunPhase;
  transformLines: string[];

  // Draft
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;

  // Confirm
  confirming: boolean;
  created: boolean;
}

const INITIAL_STATE: N8nImportState = {
  step: 'upload',
  sessionId: null,
  rawWorkflowJson: '',
  workflowName: '',
  error: null,
  parsedResult: null,
  selectedToolIndices: new Set(),
  selectedTriggerIndices: new Set(),
  selectedConnectorNames: new Set(),
  questions: null,
  userAnswers: {},
  questionsSkipped: false,
  transformSubPhase: 'idle',
  transforming: false,
  backgroundTransformId: null,
  adjustmentRequest: '',
  transformPhase: 'idle',
  transformLines: [],
  draft: null,
  draftJson: '',
  draftJsonError: null,
  confirming: false,
  created: false,
};

// ── Actions ──

export type N8nImportAction =
  | { type: 'FILE_PARSED'; workflowName: string; rawWorkflowJson: string; parsedResult: DesignAnalysisResult }
  | { type: 'TOGGLE_TOOL'; index: number }
  | { type: 'TOGGLE_TRIGGER'; index: number }
  | { type: 'TOGGLE_CONNECTOR'; name: string }
  | { type: 'SET_ADJUSTMENT'; text: string }
  | { type: 'QUESTIONS_GENERATED'; questions: TransformQuestion[] }
  | { type: 'QUESTIONS_FAILED'; error: string }
  | { type: 'QUESTIONS_SKIPPED' }
  | { type: 'ANSWER_UPDATED'; questionId: string; answer: string }
  | { type: 'TRANSFORM_STARTED'; transformId: string; subPhase?: TransformSubPhase }
  | { type: 'TRANSFORM_LINES'; lines: string[] }
  | { type: 'TRANSFORM_PHASE'; phase: CliRunPhase }
  | { type: 'TRANSFORM_COMPLETED'; draft: N8nPersonaDraft }
  | { type: 'TRANSFORM_FAILED'; error: string }
  | { type: 'TRANSFORM_CANCELLED' }
  | { type: 'DRAFT_UPDATED'; draft: N8nPersonaDraft }
  | { type: 'DRAFT_JSON_EDITED'; json: string; draft: N8nPersonaDraft | null; error: string | null }
  | { type: 'CONFIRM_STARTED' }
  | { type: 'CONFIRM_COMPLETED' }
  | { type: 'CONFIRM_FAILED'; error: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'GO_TO_STEP'; step: N8nWizardStep }
  | { type: 'RESTORE_CONTEXT'; workflowName: string; rawWorkflowJson: string; parsedResult: DesignAnalysisResult | null; transformId: string }
  | { type: 'SESSION_CREATED'; sessionId: string }
  | { type: 'SESSION_LOADED'; sessionId: string; step: N8nWizardStep; workflowName: string; rawWorkflowJson: string; parsedResult: DesignAnalysisResult | null; draft: N8nPersonaDraft | null }
  | { type: 'RESET' };

// ── Helpers ──

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function initSelectionsFromResult(result: DesignAnalysisResult): {
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
} {
  return {
    selectedToolIndices: new Set(result.suggested_tools.map((_, i) => i)),
    selectedTriggerIndices: new Set(result.suggested_triggers.map((_, i) => i)),
    selectedConnectorNames: new Set((result.suggested_connectors ?? []).map((c) => c.name)),
  };
}

// ── Reducer ──

function n8nImportReducer(state: N8nImportState, action: N8nImportAction): N8nImportState {
  switch (action.type) {
    case 'FILE_PARSED': {
      const selections = initSelectionsFromResult(action.parsedResult);
      return {
        ...INITIAL_STATE,
        step: 'analyze',
        workflowName: action.workflowName,
        rawWorkflowJson: action.rawWorkflowJson,
        parsedResult: action.parsedResult,
        ...selections,
      };
    }

    case 'TOGGLE_TOOL':
      return { ...state, selectedToolIndices: toggleInSet(state.selectedToolIndices, action.index) };

    case 'TOGGLE_TRIGGER':
      return { ...state, selectedTriggerIndices: toggleInSet(state.selectedTriggerIndices, action.index) };

    case 'TOGGLE_CONNECTOR':
      return { ...state, selectedConnectorNames: toggleInSet(state.selectedConnectorNames, action.name) };

    case 'SET_ADJUSTMENT':
      return { ...state, adjustmentRequest: action.text };

    case 'QUESTIONS_GENERATED':
      return {
        ...state,
        transformSubPhase: 'answering',
        questions: action.questions,
        // Pre-fill default answers
        userAnswers: action.questions.reduce<Record<string, string>>((acc, q) => {
          if (q.default) acc[q.id] = q.default;
          return acc;
        }, {}),
      };

    case 'QUESTIONS_FAILED':
      // Stay on transform step — user can still generate with defaults
      return {
        ...state,
        transformSubPhase: 'answering',
        questionsSkipped: true,
        questions: null,
        error: action.error || null,
      };

    case 'QUESTIONS_SKIPPED':
      return {
        ...state,
        step: 'transform',
        transformSubPhase: 'answering',
        questionsSkipped: true,
        questions: null,
      };

    case 'ANSWER_UPDATED':
      return {
        ...state,
        userAnswers: { ...state.userAnswers, [action.questionId]: action.answer },
      };

    case 'TRANSFORM_STARTED':
      return {
        ...state,
        step: 'transform',
        transformSubPhase: action.subPhase ?? 'generating',
        transforming: true,
        backgroundTransformId: action.transformId,
        transformPhase: 'running',
        transformLines: [],
        error: null,
      };

    case 'TRANSFORM_LINES':
      return { ...state, transformLines: action.lines };

    case 'TRANSFORM_PHASE':
      return { ...state, transformPhase: action.phase };

    case 'TRANSFORM_COMPLETED':
      return {
        ...state,
        step: 'edit',
        transforming: false,
        transformSubPhase: 'completed',
        transformPhase: 'completed',
        draft: action.draft,
        draftJson: JSON.stringify(action.draft, null, 2),
        draftJsonError: null,
      };

    case 'TRANSFORM_FAILED':
      return {
        ...state,
        transforming: false,
        transformSubPhase: 'failed',
        transformPhase: 'failed',
        error: action.error,
      };

    case 'TRANSFORM_CANCELLED':
      return {
        ...state,
        step: state.parsedResult ? 'analyze' : 'upload',
        transforming: false,
        transformSubPhase: 'idle',
        backgroundTransformId: null,
        transformPhase: 'idle',
        transformLines: [],
        error: null,
      };

    case 'DRAFT_UPDATED':
      return {
        ...state,
        draft: action.draft,
        draftJson: JSON.stringify(action.draft, null, 2),
        draftJsonError: null,
      };

    case 'DRAFT_JSON_EDITED':
      return {
        ...state,
        draftJson: action.json,
        draft: action.draft ?? state.draft,
        draftJsonError: action.error,
      };

    case 'CONFIRM_STARTED':
      return { ...state, confirming: true, error: null };

    case 'CONFIRM_COMPLETED':
      return { ...state, confirming: false, created: true };

    case 'CONFIRM_FAILED':
      return { ...state, confirming: false, error: action.error };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'GO_TO_STEP':
      return { ...state, step: action.step, error: null };

    case 'RESTORE_CONTEXT':
      return {
        ...state,
        step: 'transform',
        transformSubPhase: 'generating',
        workflowName: action.workflowName,
        rawWorkflowJson: action.rawWorkflowJson,
        parsedResult: action.parsedResult,
        backgroundTransformId: action.transformId,
        transforming: true,
        transformPhase: 'running',
        ...(action.parsedResult ? initSelectionsFromResult(action.parsedResult) : {}),
      };

    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };

    case 'SESSION_LOADED': {
      const selections = action.parsedResult ? initSelectionsFromResult(action.parsedResult) : {};
      // Determine sub-phase based on loaded state
      let subPhase: TransformSubPhase = 'idle';
      if (action.step === 'transform') {
        subPhase = action.draft ? 'completed' : 'answering';
      }
      return {
        ...INITIAL_STATE,
        sessionId: action.sessionId,
        step: action.step,
        workflowName: action.workflowName,
        rawWorkflowJson: action.rawWorkflowJson,
        parsedResult: action.parsedResult,
        draft: action.draft,
        draftJson: action.draft ? JSON.stringify(action.draft, null, 2) : '',
        transformSubPhase: subPhase,
        ...selections,
      };
    }

    case 'RESET':
      return INITIAL_STATE;

    default:
      return state;
  }
}

// ── Hook ──

export function useN8nImportReducer() {
  const [state, dispatch] = useReducer(n8nImportReducer, INITIAL_STATE);

  const canGoBack = state.step !== 'upload' && !state.transforming && !state.confirming && state.transformSubPhase !== 'asking';

  const goBack = useCallback(() => {
    if (!canGoBack) return;

    // From edit or transform → go to analyze (skip transform since it's a live process step)
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
