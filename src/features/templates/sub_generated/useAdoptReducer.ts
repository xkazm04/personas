import { useState, useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/n8nTransform';
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

function prefillDefaults(questions: TransformQuestionResponse[]): Record<string, string> {
  return questions.reduce<Record<string, string>>((acc, q) => {
    if (q.default) acc[q.id] = q.default;
    return acc;
  }, {});
}

// ── Hook ──

export function useAdoptReducer() {
  const [state, setState] = useState<AdoptState>(INITIAL_STATE);

  const update = useCallback((patch: Partial<AdoptState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const init = useCallback((templateName: string, reviewId: string, designResult: DesignAnalysisResult, designResultJson: string) => {
    setState({ ...INITIAL_STATE, step: 'overview', templateName, reviewId, designResult, designResultJson });
  }, []);

  const setAdjustment = useCallback((text: string) => {
    update({ adjustmentRequest: text });
  }, [update]);

  const questionsGenerating = useCallback(() => {
    update({ step: 'configure', questionGenerating: true, error: null });
  }, [update]);

  const questionsGenerated = useCallback((questions: TransformQuestionResponse[]) => {
    update({ questionGenerating: false, questions, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const questionsFailed = useCallback((error: string) => {
    update({ questionGenerating: false, questions: null, error });
  }, [update]);

  const answerUpdated = useCallback((questionId: string, answer: string) => {
    setState((prev) => ({ ...prev, userAnswers: { ...prev.userAnswers, [questionId]: answer } }));
  }, []);

  const transformStarted = useCallback((adoptId: string) => {
    update({ step: 'transform', transforming: true, backgroundAdoptId: adoptId, transformPhase: 'running', transformLines: [], error: null });
  }, [update]);

  const transformLines = useCallback((lines: string[]) => {
    update({ transformLines: lines });
  }, [update]);

  const transformPhase = useCallback((phase: CliRunPhase) => {
    update({ transformPhase: phase });
  }, [update]);

  const awaitingAnswers = useCallback((questions: TransformQuestionResponse[]) => {
    update({ step: 'configure', transforming: false, transformPhase: 'idle', questions, questionGenerating: false, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const transformCompleted = useCallback((draft: N8nPersonaDraft) => {
    update({ step: 'edit', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null });
  }, [update]);

  const transformFailed = useCallback((error: string) => {
    update({ transforming: false, backgroundAdoptId: null, transformPhase: 'failed', error });
  }, [update]);

  const transformCancelled = useCallback(() => {
    update({ step: 'overview', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
  }, [update]);

  const draftUpdated = useCallback((draft: N8nPersonaDraft) => {
    update({ draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null });
  }, [update]);

  const draftJsonEdited = useCallback((json: string, draft: N8nPersonaDraft | null, error: string | null) => {
    setState((prev) => ({ ...prev, draftJson: json, draft: draft ?? prev.draft, draftJsonError: error }));
  }, []);

  const confirmStarted = useCallback(() => {
    update({ confirming: true, error: null });
  }, [update]);

  const confirmCompleted = useCallback(() => {
    update({ confirming: false, created: true });
  }, [update]);

  const confirmFailed = useCallback((error: string) => {
    update({ confirming: false, error });
  }, [update]);

  const setError = useCallback((error: string) => {
    update({ error });
  }, [update]);

  const clearError = useCallback(() => {
    update({ error: null });
  }, [update]);

  const goToStep = useCallback((step: AdoptWizardStep) => {
    update({ step, error: null });
  }, [update]);

  const restoreContext = useCallback((templateName: string, designResultJson: string, adoptId: string) => {
    update({ step: 'transform', templateName, designResultJson, backgroundAdoptId: adoptId, transforming: true, transformPhase: 'running' });
  }, [update]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ── Navigation ──

  const canGoBack = state.step !== 'overview' && !state.transforming && !state.confirming && !state.questionGenerating;

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const idx = ADOPT_STEP_META[state.step].index;
    if (idx <= 0) return;

    const prevStep = state.step === 'edit'
      ? (state.questions ? 'configure' : 'overview')
      : state.step === 'configure'
        ? 'overview'
        : ADOPT_STEPS[idx - 1];
    if (prevStep) goToStep(prevStep);
  }, [canGoBack, state.step, state.questions, goToStep]);

  return {
    state,
    canGoBack,
    goBack,
    // Setters
    init,
    setAdjustment,
    questionsGenerating,
    questionsGenerated,
    questionsFailed,
    answerUpdated,
    transformStarted,
    transformLines,
    transformPhase,
    awaitingAnswers,
    transformCompleted,
    transformFailed,
    transformCancelled,
    draftUpdated,
    draftJsonEdited,
    confirmStarted,
    confirmCompleted,
    confirmFailed,
    setError,
    clearError,
    goToStep,
    restoreContext,
    reset,
  };
}
