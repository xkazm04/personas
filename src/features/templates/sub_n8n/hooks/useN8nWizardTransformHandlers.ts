import {
  cancelN8nTransform,
  clearN8nTransformSnapshot,
  continueN8nTransform,
  getN8nTransformSnapshot,
  startN8nTransformBackground,
} from '@/api/templates/n8nTransform';
import { useVaultStore } from '@/stores/vaultStore';
import { stringifyDraft } from './n8nTypes';
import type { WizardDeps } from './n8nWizardTypes';

export function createTransformHandlers(deps: WizardDeps) {
  const { state, dispatch, transform, session, setN8nTransformActive, transformLockRef } = deps;

  const handleTransform = async () => {
    if (!state.parsedResult || !state.rawWorkflowJson || state.transforming || state.confirming || transformLockRef.current) return;

    transformLockRef.current = true;

    try {
      const transformId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const isAdjustment = !!state.adjustmentRequest.trim() || !!state.draft;
      const subPhase = isAdjustment ? 'generating' as const : 'asking' as const;

      transform.setIsRestoring(false);
      transform.setAnalyzing(true);
      await transform.startTransformStream(transformId);
      dispatch({ type: 'TRANSFORM_STARTED', transformId, subPhase });
      setN8nTransformActive(true);
      transform.setAnalyzing(false);

      const previousDraftJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim() || null;

      let parserJson: string;
      try {
        parserJson = JSON.stringify(state.parsedResult);
      } catch {
        parserJson = '{}';
      }

      const vaultState = useVaultStore.getState();
      const connectorsJson = JSON.stringify(
        vaultState.connectorDefinitions.map((c) => ({ name: c.name, label: c.label })),
      );
      const credentialsJson = JSON.stringify(
        vaultState.credentials.map((c) => ({ name: c.name, service_type: c.service_type })),
      );

      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : null;

      await startN8nTransformBackground(
        transformId,
        state.workflowName || 'Imported Workflow',
        state.rawWorkflowJson,
        parserJson,
        state.adjustmentRequest.trim() || null,
        previousDraftJson,
        connectorsJson,
        credentialsJson,
        userAnswersJson,
        state.sessionId,
      );

      if (state.adjustmentRequest.trim()) {
        dispatch({ type: 'SET_ADJUSTMENT', text: '' });
      }
    } catch (err) {
      transform.setAnalyzing(false);
      setN8nTransformActive(false);
      session.clearPersistedContext();
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to generate transformation draft.',
      });
    } finally {
      transformLockRef.current = false;
    }
  };

  const handleCancelTransform = async () => {
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    try {
      const transformId = state.backgroundTransformId || transform.currentTransformId;
      if (transformId) {
        await cancelN8nTransform(transformId);

        let stopped = false;
        for (let i = 0; i < 6; i += 1) {
          try {
            const snapshot = await getN8nTransformSnapshot(transformId);
            if (!snapshot || (snapshot.status !== 'running' && snapshot.status !== 'awaiting_answers')) {
              stopped = true;
              break;
            }
          } catch {
            stopped = true;
            break;
          }
          await delay(250);
        }

        if (!stopped) {
          dispatch({ type: 'SET_ERROR', error: 'Unable to confirm transform cancellation. Please wait and try again.' });
          return;
        }

        void clearN8nTransformSnapshot(transformId).catch(() => {});
      }
      session.clearPersistedContext();
      void transform.resetTransformStream();
      transform.setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'TRANSFORM_CANCELLED' });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Failed to cancel transform. Please try again.',
      });
    }
  };

  const handleContinueTransform = async () => {
    if (!state.backgroundTransformId || state.transforming || transformLockRef.current) return;
    if (!state.sessionId) {
      dispatch({ type: 'SET_ERROR', error: 'Transform session is missing. Please restart the import flow.' });
      return;
    }

    transformLockRef.current = true;

    try {
      dispatch({ type: 'TRANSFORM_STARTED', transformId: state.backgroundTransformId, subPhase: 'generating' });
      setN8nTransformActive(true);
      await transform.startTransformStream(state.backgroundTransformId);

      const userAnswersJson = Object.keys(state.userAnswers).length > 0
        ? JSON.stringify(state.userAnswers)
        : '{}';

      await continueN8nTransform(
        state.backgroundTransformId,
        userAnswersJson,
        state.sessionId,
      );
    } catch (err) {
      setN8nTransformActive(false);
      session.clearPersistedContext();
      dispatch({
        type: 'TRANSFORM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to continue transformation.',
      });
    } finally {
      transformLockRef.current = false;
    }
  };

  return { handleTransform, handleCancelTransform, handleContinueTransform };
}
