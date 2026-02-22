import { useReducer, useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

// ── Persistence ──

export const ADOPT_CONTEXT_KEY = 'template-adopt-context-v1';

/** Max age for persisted context before it's considered stale (10 minutes) */
export const ADOPT_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export interface PersistedAdoptContext {
  adoptId: string;
  templateName: string;
  designResultJson: string;
  /** Timestamp when context was persisted (ms since epoch) */
  savedAt: number;
}

// ── Wizard Steps ──

export type AdoptWizardStep = 'overview' | 'configure' | 'transform' | 'edit' | 'confirm';

export const ADOPT_STEPS: readonly AdoptWizardStep[] = [
  'overview',
  'configure',
  'transform',
  'edit',
  'confirm',
] as const;

export const ADOPT_STEP_META: Record<AdoptWizardStep, { label: string; index: number }> = {
  overview:  { label: 'Overview',   index: 0 },
  configure: { label: 'Configure',  index: 1 },
  transform: { label: 'Transform',  index: 2 },
  edit:      { label: 'Edit',       index: 3 },
  confirm:   { label: 'Confirm',    index: 4 },
};

// ── State ──

export interface AdoptState {
  step: AdoptWizardStep;

  // Template context
  templateName: string;
  reviewId: string;
  designResult: DesignAnalysisResult | null;
  designResultJson: string;

  // Configure (pre-transform questions)
  questions: TransformQuestionResponse[] | null;
  userAnswers: Record<string, string>;
  questionGenerating: boolean;

  // Transform
  transforming: boolean;
  backgroundAdoptId: string | null;
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
  error: string | null;
}

const INITIAL_STATE: AdoptState = {
  step: 'overview',
  templateName: '',
  reviewId: '',
  designResult: null,
  designResultJson: '',
  questions: null,
  userAnswers: {},
  questionGenerating: false,
  transforming: false,
  backgroundAdoptId: null,
  adjustmentRequest: '',
  transformPhase: 'idle',
  transformLines: [],
  draft: null,
  draftJson: '',
  draftJsonError: null,
  confirming: false,
  created: false,
  error: null,
};

// ── Actions ──

export type AdoptAction =
  | { type: 'INIT'; templateName: string; reviewId: string; designResult: DesignAnalysisResult; designResultJson: string }
  | { type: 'SET_ADJUSTMENT'; text: string }
  | { type: 'QUESTIONS_GENERATING' }
  | { type: 'QUESTIONS_GENERATED'; questions: TransformQuestionResponse[] }
  | { type: 'QUESTIONS_FAILED'; error: string }
  | { type: 'ANSWER_UPDATED'; questionId: string; answer: string }
  | { type: 'TRANSFORM_STARTED'; adoptId: string }
  | { type: 'TRANSFORM_LINES'; lines: string[] }
  | { type: 'TRANSFORM_PHASE'; phase: CliRunPhase }
  | { type: 'AWAITING_ANSWERS'; questions: TransformQuestionResponse[] }
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
  | { type: 'GO_TO_STEP'; step: AdoptWizardStep }
  | { type: 'RESTORE_CONTEXT'; templateName: string; designResultJson: string; adoptId: string }
  | { type: 'RESET' };

// ── Reducer ──

function adoptReducer(state: AdoptState, action: AdoptAction): AdoptState {
  switch (action.type) {
    case 'INIT':
      return {
        ...INITIAL_STATE,
        step: 'overview',
        templateName: action.templateName,
        reviewId: action.reviewId,
        designResult: action.designResult,
        designResultJson: action.designResultJson,
      };

    case 'SET_ADJUSTMENT':
      return { ...state, adjustmentRequest: action.text };

    case 'QUESTIONS_GENERATING':
      return { ...state, step: 'configure', questionGenerating: true, error: null };

    case 'QUESTIONS_GENERATED':
      return {
        ...state,
        questionGenerating: false,
        questions: action.questions,
        // Pre-fill default answers
        userAnswers: action.questions.reduce<Record<string, string>>((acc, q) => {
          if (q.default) acc[q.id] = q.default;
          return acc;
        }, {}),
      };

    case 'QUESTIONS_FAILED':
      // On failure, skip configure step — user can still proceed to transform
      return { ...state, questionGenerating: false, questions: null, error: action.error };

    case 'ANSWER_UPDATED':
      return {
        ...state,
        userAnswers: { ...state.userAnswers, [action.questionId]: action.answer },
      };

    case 'TRANSFORM_STARTED':
      return {
        ...state,
        step: 'transform',
        transforming: true,
        backgroundAdoptId: action.adoptId,
        transformPhase: 'running',
        transformLines: [],
        error: null,
      };

    case 'TRANSFORM_LINES':
      return { ...state, transformLines: action.lines };

    case 'TRANSFORM_PHASE':
      return { ...state, transformPhase: action.phase };

    case 'AWAITING_ANSWERS':
      return {
        ...state,
        step: 'configure',
        transforming: false,
        transformPhase: 'idle',
        questions: action.questions,
        questionGenerating: false,
        // Pre-fill default answers
        userAnswers: action.questions.reduce<Record<string, string>>((acc, q) => {
          if (q.default) acc[q.id] = q.default;
          return acc;
        }, {}),
      };

    case 'TRANSFORM_COMPLETED':
      return {
        ...state,
        step: 'edit',
        transforming: false,
        transformPhase: 'completed',
        draft: action.draft,
        draftJson: JSON.stringify(action.draft, null, 2),
        draftJsonError: null,
      };

    case 'TRANSFORM_FAILED':
      return {
        ...state,
        transforming: false,
        backgroundAdoptId: null,
        transformPhase: 'failed',
        error: action.error,
      };

    case 'TRANSFORM_CANCELLED':
      return {
        ...state,
        step: 'overview',
        transforming: false,
        backgroundAdoptId: null,
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
        templateName: action.templateName,
        designResultJson: action.designResultJson,
        backgroundAdoptId: action.adoptId,
        transforming: true,
        transformPhase: 'running',
      };

    case 'RESET':
      return INITIAL_STATE;

    default:
      return state;
  }
}

// ── Hook ──

export function useAdoptReducer() {
  const [state, dispatch] = useReducer(adoptReducer, INITIAL_STATE);

  const canGoBack = state.step !== 'overview' && !state.transforming && !state.confirming && !state.questionGenerating;

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const idx = ADOPT_STEP_META[state.step].index;
    if (idx <= 0) return;

    // Skip transform step when going back (go to configure or overview)
    const prevStep = state.step === 'edit'
      ? (state.questions ? 'configure' : 'overview')
      : state.step === 'configure'
        ? 'overview'
        : ADOPT_STEPS[idx - 1];
    if (prevStep) dispatch({ type: 'GO_TO_STEP', step: prevStep });
  }, [canGoBack, state.step, state.questions]);

  return { state, dispatch, canGoBack, goBack };
}
