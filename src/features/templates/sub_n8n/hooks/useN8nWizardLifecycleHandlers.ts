import { silentCatch } from "@/lib/silentCatch";
import {
  clearN8nTransformSnapshot,
  confirmN8nPersonaDraft,
} from '@/api/templates/n8nTransform';
import { testN8nDraft } from '@/api/agents/tests';
import { normalizeDraftFromUnknown, stringifyDraft } from './n8nTypes';
import type { ConfirmResult } from '../steps/confirm/N8nConfirmStep';
import type { WizardDeps } from './n8nWizardTypes';

export function createLifecycleHandlers(deps: WizardDeps) {
  const {
    state, dispatch,
    transform, test, session,
    setN8nTransformActive, fetchPersonas, selectPersona,
    setConfirmResult, confirmingRef, fileInputRef,
  } = deps;

  const handleConfirmSave = async () => {
    if (confirmingRef.current) return;
    try {
      const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
      if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

      confirmingRef.current = true;
      dispatch({ type: 'CONFIRM_STARTED' });

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadJson);
      } catch (parseErr) {
        dispatch({ type: 'CONFIRM_FAILED', error: `Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}` });
        return;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        dispatch({ type: 'CONFIRM_FAILED', error: 'Draft JSON is invalid. Please fix draft fields.' });
        return;
      }

      const response = await confirmN8nPersonaDraft(payloadJson, state.sessionId);
      await fetchPersonas();
      selectPersona(response.persona.id);

      const responseObj = response as Record<string, unknown>;
      const rawErrors = Array.isArray(responseObj.entity_errors) ? responseObj.entity_errors : [];
      setConfirmResult({
        triggersCreated: typeof responseObj.triggers_created === 'number' ? responseObj.triggers_created : 0,
        toolsCreated: typeof responseObj.tools_created === 'number' ? responseObj.tools_created : 0,
        connectorsNeedingSetup: Array.isArray(responseObj.connectors_needing_setup)
          ? (responseObj.connectors_needing_setup as string[])
          : [],
        entityErrors: rawErrors as ConfirmResult['entityErrors'],
      });

      dispatch({ type: 'CONFIRM_COMPLETED' });
      session.remove();

      if (state.backgroundTransformId) {
        void clearN8nTransformSnapshot(state.backgroundTransformId).catch(silentCatch("LifecycleHandlers:clearConfirmSnapshot"));
      }
      session.clearPersistedContext();
    } catch (err) {
      dispatch({
        type: 'CONFIRM_FAILED',
        error: err instanceof Error ? err.message : 'Failed to confirm and save persona.',
      });
    } finally {
      confirmingRef.current = false;
    }
  };

  const handleTestDraft = async () => {
    if (!state.draft || state.testStatus === 'running') return;
    const testId = crypto.randomUUID();
    dispatch({ type: 'TEST_STREAM_STARTED', testId });
    try {
      await test.startTestStream(testId);
      await testN8nDraft(testId, stringifyDraft(state.draft));
    } catch (err) {
      dispatch({ type: 'TEST_FAILED', error: err instanceof Error ? err.message : 'Test failed' });
    }
  };

  const handleReset = () => {
    try {
      const snapshotId = state.backgroundTransformId || transform.currentTransformId;
      if (snapshotId) {
        void clearN8nTransformSnapshot(snapshotId).catch(silentCatch("LifecycleHandlers:clearResetSnapshot"));
      }
      session.clearPersistedContext();
      void transform.resetTransformStream();
      void test.resetTestStream();
      transform.setIsRestoring(false);
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setN8nTransformActive(false);
      dispatch({ type: 'RESET' });
    }
  };

  return { handleConfirmSave, handleTestDraft, handleReset };
}
