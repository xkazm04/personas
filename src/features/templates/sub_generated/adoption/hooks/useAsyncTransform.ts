/**
 * useAsyncTransform - consolidates CLI stream, background snapshot polling,
 * localStorage persistence, and all async adoption handlers into a single
 * orchestration layer.
 *
 * Split into sub-modules for maintainability:
 *   - asyncTransformTypes.ts   (shared types, constants, helpers)
 *   - useSnapshotCallbacks.ts  (background snapshot polling callbacks)
 *   - useTransformActions.ts   (start / cancel / continue transform)
 *   - useConfirmSave.ts        (confirm save + cleanup)
 */
import { useCallback, useRef, useState } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import { usePersistedContext } from '@/hooks/utility/data/usePersistedContext';
import { ADOPT_CONTEXT_MAX_AGE_MS } from './useAdoptReducer';
import type { PersistedAdoptContext } from '../state/asyncTransformTypes';
import { ADOPT_CONTEXT_KEY } from '../state/asyncTransformTypes';
import type { UseAsyncTransformOptions } from '../state/asyncTransformTypes';
import { useSnapshotCallbacks } from './useSnapshotCallbacks';
import { useTransformActions } from './useTransformActions';
import { useConfirmSave } from './useConfirmSave';

export type { WizardActions, UseAsyncTransformOptions } from '../state/asyncTransformTypes';

export function useAsyncTransform({
  state,
  wizard,
  reviewTestCaseName,
  onPersonaCreated,
  isOpen,
  sandboxPolicy,
  safetyScan,
}: UseAsyncTransformOptions) {
  const confirmingRef = useRef(false);
  const transformStartingRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // -- CLI stream --

  const {
    runId: currentAdoptId,
    start: startAdoptStream,
    reset: resetAdoptStream,
    setLines: setStreamLines,
    setPhase: setStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: EventName.TEMPLATE_ADOPT_OUTPUT,
    statusEvent: EventName.TEMPLATE_ADOPT_STATUS,
    idField: 'adopt_id',
    onFailed: (message) => wizard.transformFailed(message),
  });

  // -- Restore persisted context --

  const handleRestoreContext = useCallback(
    (parsed: PersistedAdoptContext) => {
      setIsRestoring(true);
      wizard.restoreContext(parsed.templateName || '', parsed.designResultJson || '', parsed.adoptId);
      void startAdoptStream(parsed.adoptId);
    },
    [wizard.restoreContext, startAdoptStream],
  );

  usePersistedContext<PersistedAdoptContext>({
    key: ADOPT_CONTEXT_KEY,
    maxAge: ADOPT_CONTEXT_MAX_AGE_MS,
    enabled: isOpen,
    validate: useCallback((parsed: PersistedAdoptContext) => parsed?.adoptId || null, []),
    getSavedAt: useCallback((parsed: PersistedAdoptContext) => parsed.savedAt, []),
    onRestore: handleRestoreContext,
  });

  // -- Snapshot callbacks --

  useSnapshotCallbacks({
    backgroundAdoptId: state.backgroundAdoptId,
    wizard,
    setStreamLines,
    setStreamPhase,
    setIsRestoring,
  });

  // -- Transform actions --

  const { startTransform, cancelTransform, continueTransform } = useTransformActions({
    state,
    wizard,
    currentAdoptId,
    transformStartingRef,
    sandboxPolicy,
    startAdoptStream,
    resetAdoptStream,
    setIsRestoring,
  });

  // -- Confirm & cleanup --

  const { confirmSave, cleanupAll } = useConfirmSave({
    state,
    wizard,
    currentAdoptId,
    confirmingRef,
    reviewTestCaseName,
    onPersonaCreated,
    sandboxPolicy,
    safetyScan,
    resetAdoptStream,
  });

  return {
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    continueTransform,
    confirmSave,
    cleanupAll,
  };
}
