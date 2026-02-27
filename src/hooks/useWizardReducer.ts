import { useState, useCallback } from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';

// ── Base constraint for wizard state ──

export interface WizardStateBase {
  step: string;
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;
  adjustmentRequest: string;
  error: string | null;
}

// ── Step metadata ──

export interface StepMeta {
  label: string;
  index: number;
}

// ── Options for the factory ──

export interface WizardReducerOptions<S extends WizardStateBase> {
  initialState: S;
  stepMeta: Record<string, StepMeta>;
  /** Given current state, return true if the user can navigate backward. */
  canGoBack: (state: S) => boolean;
  /** Given current state + goToStep helper, perform the back navigation. */
  goBack: (state: S, goToStep: (step: S['step']) => void) => void;
}

// ── Return type ──

export interface WizardReducerCore<S extends WizardStateBase> {
  state: S;
  update: (patch: Partial<S>) => void;
  canGoBack: boolean;
  goBack: () => void;
  goToStep: (step: S['step']) => void;
  setAdjustment: (text: string) => void;
  draftUpdated: (draft: N8nPersonaDraft) => void;
  draftJsonEdited: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
  setError: (error: string) => void;
  clearError: () => void;
  reset: () => void;
}

// ── Factory hook ──

export function useWizardReducer<S extends WizardStateBase>(
  options: WizardReducerOptions<S>,
): WizardReducerCore<S> {
  const { initialState, canGoBack: canGoBackFn, goBack: goBackFn } = options;

  const [state, setState] = useState<S>(initialState);

  const update = useCallback((patch: Partial<S>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const goToStep = useCallback((step: S['step']) => {
    update({ step, error: null } as Partial<S>);
  }, [update]);

  const setAdjustment = useCallback((text: string) => {
    update({ adjustmentRequest: text } as Partial<S>);
  }, [update]);

  const draftUpdated = useCallback((draft: N8nPersonaDraft) => {
    update({ draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null } as Partial<S>);
  }, [update]);

  const draftJsonEdited = useCallback((json: string, draft: N8nPersonaDraft | null, error: string | null) => {
    setState((prev) => ({ ...prev, draftJson: json, draft: draft ?? prev.draft, draftJsonError: error }));
  }, []);

  const setError = useCallback((error: string) => {
    update({ error } as Partial<S>);
  }, [update]);

  const clearError = useCallback(() => {
    update({ error: null } as Partial<S>);
  }, [update]);

  const reset = useCallback(() => {
    setState(initialState);
  }, [initialState]);

  const canGoBack = canGoBackFn(state);

  const goBack = useCallback(() => {
    if (!canGoBackFn(state)) return;
    goBackFn(state, goToStep);
  }, [state, canGoBackFn, goBackFn, goToStep]);

  return {
    state,
    update,
    canGoBack,
    goBack,
    goToStep,
    setAdjustment,
    draftUpdated,
    draftJsonEdited,
    setError,
    clearError,
    reset,
  };
}
