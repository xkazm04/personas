import { useState, useCallback } from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

// ── Persistence ──

export const CREATE_TEMPLATE_CONTEXT_KEY = 'create-template-context-v1';
export const CREATE_TEMPLATE_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export interface PersistedCreateTemplateContext {
  genId: string;
  templateName: string;
  description: string;
  savedAt: number;
}

// ── Wizard Steps ──

export type CreateTemplateStep = 'describe' | 'generate' | 'review';

export const CREATE_TEMPLATE_STEPS: readonly CreateTemplateStep[] = [
  'describe',
  'generate',
  'review',
] as const;

export const CREATE_TEMPLATE_STEP_META: Record<CreateTemplateStep, { label: string; index: number }> = {
  describe: { label: 'Describe', index: 0 },
  generate: { label: 'Generate', index: 1 },
  review:   { label: 'Review',   index: 2 },
};

// ── State ──

export interface CreateTemplateState {
  step: CreateTemplateStep;
  templateName: string;
  description: string;

  // Generation
  generating: boolean;
  backgroundGenId: string | null;
  generatePhase: CliRunPhase;
  generateLines: string[];

  // Result
  designResultJson: string;

  // Review/Edit
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;
  adjustmentRequest: string;
  transforming: boolean;

  // Save
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const INITIAL_STATE: CreateTemplateState = {
  step: 'describe',
  templateName: '',
  description: '',
  generating: false,
  backgroundGenId: null,
  generatePhase: 'idle',
  generateLines: [],
  designResultJson: '',
  draft: null,
  draftJson: '',
  draftJsonError: null,
  adjustmentRequest: '',
  transforming: false,
  saving: false,
  saved: false,
  error: null,
};

// ── Hook ──

export function useCreateTemplateReducer() {
  const [state, setState] = useState<CreateTemplateState>(INITIAL_STATE);

  const update = useCallback((patch: Partial<CreateTemplateState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setTemplateName = useCallback((name: string) => {
    update({ templateName: name });
  }, [update]);

  const setDescription = useCallback((desc: string) => {
    update({ description: desc });
  }, [update]);

  const generateStarted = useCallback((genId: string) => {
    update({
      step: 'generate',
      generating: true,
      backgroundGenId: genId,
      generatePhase: 'running',
      generateLines: [],
      error: null,
    });
  }, [update]);

  const generateLines = useCallback((lines: string[]) => {
    update({ generateLines: lines });
  }, [update]);

  const generatePhase = useCallback((phase: CliRunPhase) => {
    update({ generatePhase: phase });
  }, [update]);

  const generateCompleted = useCallback((draft: N8nPersonaDraft, designResultJson: string) => {
    update({
      step: 'review',
      generating: false,
      generatePhase: 'completed',
      designResultJson,
      draft,
      draftJson: JSON.stringify(draft, null, 2),
      draftJsonError: null,
    });
  }, [update]);

  const generateFailed = useCallback((error: string) => {
    update({
      generating: false,
      backgroundGenId: null,
      generatePhase: 'failed',
      error,
    });
  }, [update]);

  const generateCancelled = useCallback(() => {
    update({
      step: 'describe',
      generating: false,
      backgroundGenId: null,
      generatePhase: 'idle',
      generateLines: [],
      error: null,
    });
  }, [update]);

  const draftUpdated = useCallback((draft: N8nPersonaDraft) => {
    update({ draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null });
  }, [update]);

  const draftJsonEdited = useCallback((json: string, draft: N8nPersonaDraft | null, error: string | null) => {
    setState((prev) => ({ ...prev, draftJson: json, draft: draft ?? prev.draft, draftJsonError: error }));
  }, []);

  const setAdjustment = useCallback((text: string) => {
    update({ adjustmentRequest: text });
  }, [update]);

  const saveStarted = useCallback(() => {
    update({ saving: true, error: null });
  }, [update]);

  const saveCompleted = useCallback(() => {
    update({ saving: false, saved: true });
  }, [update]);

  const saveFailed = useCallback((error: string) => {
    update({ saving: false, error });
  }, [update]);

  const setError = useCallback((error: string) => {
    update({ error });
  }, [update]);

  const clearError = useCallback(() => {
    update({ error: null });
  }, [update]);

  const goToStep = useCallback((step: CreateTemplateStep) => {
    update({ step, error: null });
  }, [update]);

  const restoreContext = useCallback((templateName: string, description: string, genId: string) => {
    update({
      step: 'generate',
      templateName,
      description,
      backgroundGenId: genId,
      generating: true,
      generatePhase: 'running',
    });
  }, [update]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ── Navigation ──

  const canGoBack = state.step !== 'describe' && !state.generating && !state.saving;

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    if (state.step === 'review') goToStep('describe');
    else if (state.step === 'generate' && !state.generating) goToStep('describe');
  }, [canGoBack, state.step, state.generating, goToStep]);

  return {
    state,
    canGoBack,
    goBack,
    setTemplateName,
    setDescription,
    generateStarted,
    generateLines,
    generatePhase,
    generateCompleted,
    generateFailed,
    generateCancelled,
    draftUpdated,
    draftJsonEdited,
    setAdjustment,
    saveStarted,
    saveCompleted,
    saveFailed,
    setError,
    clearError,
    goToStep,
    restoreContext,
    reset,
  };
}
