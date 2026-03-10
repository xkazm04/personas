import { useCallback, useRef, useEffect, useState } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useN8nImportReducer, STEP_META } from './useN8nImportReducer';
import { useN8nSession } from './useN8nSession';
import { useN8nTransform } from './useN8nTransform';
import { useN8nTest } from './useN8nTest';
import { useWorkflowImport } from './useWorkflowImport';
import { createWizardHandlers } from './useN8nWizardHandlers';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { ConfirmResult } from '../steps/confirm/N8nConfirmStep';

/**
 * Orchestrator hook for the n8n import wizard.
 *
 * Composes useN8nSession, useN8nTransform, and useN8nTest, wires them to
 * the useN8nImportReducer, and exposes a clean API for the thin UI renderer.
 */
export function useN8nWizard() {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setN8nTransformActive = usePersonaStore((s) => s.setN8nTransformActive);
  const { state, dispatch, canGoBack, goBack } = useN8nImportReducer();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef(STEP_META[state.step].index);
  const confirmingRef = useRef(false);
  const transformLockRef = useRef(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // -- Composed hooks --

  const session = useN8nSession(state, dispatch);

  const transform = useN8nTransform(
    state.backgroundTransformId,
    state.snapshotEpoch,
    dispatch,
    session.clearPersistedContext,
    setN8nTransformActive,
  );

  const test = useN8nTest(dispatch);

  // -- Slide direction tracking --

  const currentIndex = STEP_META[state.step].index;
  const direction = currentIndex >= prevStepRef.current ? 1 : -1;
  useEffect(() => {
    prevStepRef.current = currentIndex;
  }, [currentIndex]);

  const { clearPersistedContext, create: createSession, remove: removeSession } = session;
  const { resetTransformStream, setIsRestoring } = transform;

  const { processContent, processFile } = useWorkflowImport({
    dispatch,
    removeSession,
    clearPersistedContext,
    resetTransformStream,
    setIsRestoring,
    createSession,
  });

  // -- Handlers (delegated to extracted module) --

  const handlers = createWizardHandlers({
    state,
    dispatch,
    transform,
    test,
    session: { clearPersistedContext, remove: removeSession },
    setN8nTransformActive,
    fetchPersonas,
    selectPersona,
    setConfirmResult,
    transformLockRef,
    confirmingRef,
    fileInputRef,
  });

  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      dispatch({ type: 'DRAFT_UPDATED', draft: updater(state.draft) });
    },
    [state.draft, dispatch],
  );

  return {
    // State
    state,
    dispatch,

    // Navigation
    canGoBack,
    goBack,
    handleNext: handlers.handleNext,

    // Handlers
    processFile,
    processContent,
    handleTransform: handlers.handleTransform,
    handleCancelTransform: handlers.handleCancelTransform,
    handleTestDraft: handlers.handleTestDraft,
    handleReset: handlers.handleReset,
    updateDraft,

    // Transform state
    currentTransformId: transform.currentTransformId,
    isRestoring: transform.isRestoring,
    analyzing: transform.analyzing,

    // Confirm state
    confirmResult,
    connectorsMissing,
    setConnectorsMissing,

    // Refs
    fileInputRef,

    // Animation
    direction,
  };
}
