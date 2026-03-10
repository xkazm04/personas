import { useCallback, useRef } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import {
  generateTemplateBackground,
  clearTemplateGenerateSnapshot,
  cancelTemplateGenerate,
  saveCustomTemplate,
} from '@/api/templates/templateAdopt';
import { usePersistedContext } from '@/hooks/utility/data/usePersistedContext';
import {
  useCreateTemplateReducer,
  CREATE_TEMPLATE_CONTEXT_KEY,
  CREATE_TEMPLATE_CONTEXT_MAX_AGE_MS,
} from './useCreateTemplateReducer';
import type { PersistedCreateTemplateContext } from './useCreateTemplateReducer';
import { persistContext, clearPersistedContext } from './modals/createTemplateTypes';
import { useCreateTemplateSnapshot } from './useCreateTemplateSnapshot';

export function useCreateTemplateActions(isOpen: boolean, onTemplateCreated: () => void) {
  const reducer = useCreateTemplateReducer();
  const { state } = reducer;
  const genIdRef = useRef<string | null>(null);

  // ── Persisted context (restore on open) ──
  usePersistedContext<PersistedCreateTemplateContext>({
    key: CREATE_TEMPLATE_CONTEXT_KEY,
    maxAge: CREATE_TEMPLATE_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: (parsed) => parsed.genId || null,
    getSavedAt: (parsed) => parsed.savedAt,
    onRestore: useCallback((ctx: PersistedCreateTemplateContext) => {
      genIdRef.current = ctx.genId;
      reducer.restoreContext(ctx.templateName, ctx.description, ctx.genId);
    }, [reducer]),
  });

  // ── Background snapshot polling + event listeners ──
  useCreateTemplateSnapshot(reducer, state.backgroundGenId, genIdRef);

  // ── Actions ──

  const handleStartGenerate = useCallback(async () => {
    if (!state.templateName.trim() || !state.description.trim()) return;

    const genId = `tpl-gen-${Date.now()}`;
    genIdRef.current = genId;
    reducer.generateStarted(genId);

    persistContext({
      genId,
      templateName: state.templateName,
      description: state.description,
      savedAt: Date.now(),
    });

    try {
      await generateTemplateBackground(genId, state.templateName.trim(), state.description.trim());
    } catch (err) {
      reducer.generateFailed(err instanceof Error ? err.message : String(err));
      clearPersistedContext();
    }
  }, [state.templateName, state.description, reducer]);

  const handleCancel = useCallback(async () => {
    if (state.backgroundGenId) {
      try {
        await cancelTemplateGenerate(state.backgroundGenId);
      } catch { /* intentional: non-critical — best-effort cancellation */ }
    }
    reducer.generateCancelled();
    clearPersistedContext();
  }, [state.backgroundGenId, reducer]);

  const handleRetry = useCallback(() => {
    reducer.generateCancelled();
    clearPersistedContext();
    setTimeout(() => {
      void handleStartGenerate();
    }, 100);
  }, [reducer, handleStartGenerate]);

  const handleSaveTemplate = useCallback(async () => {
    if (!state.draft) return;
    reducer.saveStarted();

    try {
      const designResultJson = state.designResultJson || JSON.stringify({
        structured_prompt: state.draft.structured_prompt,
        full_prompt_markdown: state.draft.system_prompt,
        summary: state.draft.description || '',
        persona_meta: {
          name: state.draft.name,
          icon: state.draft.icon,
          color: state.draft.color,
          model_profile: state.draft.model_profile,
        },
      });

      await saveCustomTemplate(
        state.templateName || state.draft.name || 'Custom Template',
        state.description,
        designResultJson,
      );

      reducer.saveCompleted();
      clearPersistedContext();

      if (genIdRef.current) {
        try {
          await clearTemplateGenerateSnapshot(genIdRef.current);
        } catch { /* intentional: non-critical — snapshot cleanup */ }
      }

      onTemplateCreated();
    } catch (err) {
      reducer.saveFailed(err instanceof Error ? err.message : String(err));
    }
  }, [state.draft, state.designResultJson, state.templateName, state.description, reducer, onTemplateCreated]);

  // ── Draft update helpers ──

  const updateDraft = useCallback((updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
    if (!state.draft) return;
    const updated = updater(state.draft);
    reducer.draftUpdated(updated);
  }, [state.draft, reducer]);

  const handleApplyAdjustment = useCallback(async () => {
    if (!state.adjustmentRequest.trim() || !state.draft) return;

    const genId = `tpl-gen-${Date.now()}`;
    genIdRef.current = genId;

    const enrichedDescription = `${state.description}\n\nAdditional requirements: ${state.adjustmentRequest}`;

    reducer.generateStarted(genId);
    persistContext({
      genId,
      templateName: state.templateName,
      description: enrichedDescription,
      savedAt: Date.now(),
    });

    try {
      await generateTemplateBackground(genId, state.templateName.trim(), enrichedDescription);
    } catch (err) {
      reducer.generateFailed(err instanceof Error ? err.message : String(err));
      clearPersistedContext();
    }
  }, [state.adjustmentRequest, state.draft, state.description, state.templateName, reducer]);

  // ── Close handler ──
  const handleClose = useCallback(() => {
    if (state.generating) {
      return true; // signal: just close, don't reset
    }
    if (!state.saved) {
      clearPersistedContext();
    }
    reducer.reset();
    return false;
  }, [state.generating, state.saved, reducer]);

  return {
    state,
    reducer,
    handleStartGenerate,
    handleCancel,
    handleRetry,
    handleSaveTemplate,
    updateDraft,
    handleApplyAdjustment,
    handleClose,
  };
}
