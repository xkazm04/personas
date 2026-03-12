import { useCallback } from 'react';
import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { prefillDefaults } from './adoptHelpers';
import type { AdoptState } from './adoptTypes';

type UpdateFn = (partial: Partial<AdoptState>) => void;
type UpdateWithPrev = (fn: (prev: AdoptState) => AdoptState) => void;

/**
 * Domain-specific actions for the adopt reducer (questions, transform, confirm, etc.).
 * Separated from useAdoptReducer to keep file sizes manageable.
 */
export function useAdoptDomainActions(update: UpdateFn, updateFn: UpdateWithPrev) {
  const questionsGenerating = useCallback(() => {
    update({ step: 'tune', questionGenerating: true, error: null });
  }, [update]);

  const questionsGenerated = useCallback((questions: TransformQuestionResponse[]) => {
    update({ questionGenerating: false, questions, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const questionsFailed = useCallback((error: string) => {
    update({ questionGenerating: false, questions: null, error });
  }, [update]);

  const answerUpdated = useCallback((questionId: string, answer: string) => {
    updateFn((prev) => ({ ...prev, userAnswers: { ...prev.userAnswers, [questionId]: answer } }));
  }, [updateFn]);

  const transformStarted = useCallback((adoptId: string) => {
    update({ step: 'build', transforming: true, backgroundAdoptId: adoptId, transformPhase: 'running', transformLines: [], error: null, questions: null });
  }, [update]);

  const transformLines = useCallback((lines: string[]) => {
    update({ transformLines: lines });
  }, [update]);

  const transformPhase = useCallback((phase: CliRunPhase) => {
    update({ transformPhase: phase });
  }, [update]);

  const awaitingAnswers = useCallback((questions: TransformQuestionResponse[]) => {
    // Stay on current step (build for full wizard, quick adopt doesn't use steps)
    // -- questions are rendered inline in the build step / command center
    update({ transforming: false, transformPhase: 'idle', questions, questionGenerating: false, userAnswers: prefillDefaults(questions) });
  }, [update]);

  const transformCompleted = useCallback((draft: N8nPersonaDraft) => {
    update({ step: 'create', transforming: false, transformPhase: 'completed', draft, draftJson: JSON.stringify(draft, null, 2), draftJsonError: null, safetyCriticalOverride: false });
  }, [update]);

  const transformFailed = useCallback((error: string) => {
    update({ transforming: false, backgroundAdoptId: null, transformPhase: 'failed', error });
  }, [update]);

  const transformCancelled = useCallback(() => {
    update({ step: 'tune', transforming: false, backgroundAdoptId: null, transformPhase: 'idle', transformLines: [], error: null });
  }, [update]);

  const confirmStarted = useCallback(() => {
    update({ confirming: true, error: null });
  }, [update]);

  const confirmCompleted = useCallback(() => {
    update({ confirming: false, created: true });
  }, [update]);

  const confirmFailed = useCallback((error: string) => {
    update({ confirming: false, error });
  }, [update]);

  const restoreContext = useCallback((templateName: string, designResultJson: string, adoptId: string) => {
    update({ step: 'build', templateName, designResultJson, backgroundAdoptId: adoptId, transforming: true, transformPhase: 'running' });
  }, [update]);

  const setAutoResolved = useCallback((autoResolved: boolean) => {
    update({ autoResolved });
  }, [update]);

  const setSafetyCriticalOverride = useCallback((override: boolean) => {
    update({ safetyCriticalOverride: override });
  }, [update]);

  return {
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
    confirmStarted,
    confirmCompleted,
    confirmFailed,
    restoreContext,
    setAutoResolved,
    setSafetyCriticalOverride,
  };
}
