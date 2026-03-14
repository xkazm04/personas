import { useCallback, useSyncExternalStore } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import {
  parseDesignContext,
  serializeDesignContext,
  mergeCredentialLink,
} from '@/features/shared/components/use-cases/UseCasesList';
import type { DesignFilesSection, DesignUseCase } from '@/lib/types/frontendTypes';

// -- Mutation result type ------------------------------------------------

export type MutationResult =
  | { applied: true }
  | { applied: false; reason: string };

// -- Serialized design_context write queue ----------------------------
//
// design_context is a shared JSON blob. Multiple components (UseCaseDetailPanel,
// DesignTab, PersonaConnectorsTab) can issue concurrent read-modify-write updates.
// Without serialization the last writer wins, silently overwriting other changes.
//
// `applyDesignContextMutation` queues writes so each mutation reads the LATEST
// design_context from the store (after previous writes have landed) before applying.

let writeQueue: Promise<unknown> = Promise.resolve();

// -- Pending write counter (reactive) ------------------------------------

let pendingWriteCount = 0;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const l of listeners) l();
}

function incrementPending() {
  pendingWriteCount++;
  notifyListeners();
}

function decrementPending() {
  pendingWriteCount--;
  notifyListeners();
}

function subscribePending(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot() {
  return pendingWriteCount;
}

/** React hook that returns the number of pending design_context writes. */
export function usePendingWriteCount(): number {
  return useSyncExternalStore(subscribePending, getSnapshot, getSnapshot);
}

/**
 * Queue a design_context mutation that is applied atomically.
 *
 * @param personaId  - the persona to update
 * @param mutator    - receives the *current* raw design_context and returns the new value
 * @returns a promise that resolves with a typed result indicating success or failure
 */
export function applyDesignContextMutation(
  personaId: string,
  mutator: (currentDesignContext: string | null | undefined) => string,
): Promise<MutationResult> {
  // Snapshot design_context at enqueue time so the mutation can still apply
  // even if the user switches personas before this queued write executes.
  const snapshotStore = useAgentStore.getState();
  const snapshotPersona = snapshotStore.personas.find((p) => p.id === personaId)
    ?? (snapshotStore.selectedPersona?.id === personaId ? snapshotStore.selectedPersona : null);
  const snapshotContext = snapshotPersona?.design_context;

  incrementPending();

  const doWrite = async (): Promise<MutationResult> => {
    try {
      const store = useAgentStore.getState();

      // Check if persona still exists in state
      const existsInList = store.personas.some((p) => p.id === personaId);
      const isSelected = store.selectedPersona?.id === personaId;
      if (!existsInList && !isSelected && !snapshotPersona) {
        return { applied: false, reason: `Persona ${personaId} no longer exists` };
      }

      // Prefer fresh state if persona is still selected (benefits from prior queued writes).
      // Fall back to the enqueue-time snapshot if the user switched away.
      const freshPersona = isSelected ? store.selectedPersona : null;
      const currentContext = freshPersona ? freshPersona.design_context : snapshotContext;
      const newContext = mutator(currentContext);
      await store.applyPersonaOp(personaId, {
        kind: 'UpdateDesignContext',
        design_context: newContext,
      });
      return { applied: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { applied: false, reason: message };
    }
  };

  const resultPromise = writeQueue.then(doWrite, doWrite);
  // Keep the chain going regardless of result shape
  writeQueue = resultPromise;

  // Decrement counter when this write settles
  void resultPromise.finally(decrementPending);

  return resultPromise;
}

// -- Typed section mutators -------------------------------------------

/** Mutate the useCases section of design_context. */
export function mutateUseCases(
  personaId: string,
  updater: (useCases: DesignUseCase[]) => DesignUseCase[],
): Promise<MutationResult> {
  return applyDesignContextMutation(personaId, (ctx) => {
    const data = parseDesignContext(ctx);
    return serializeDesignContext({ ...data, useCases: updater(data.useCases ?? []) });
  });
}

/** Mutate a single use case by ID inside design_context. */
export function mutateSingleUseCase(
  personaId: string,
  useCaseId: string,
  updater: (uc: DesignUseCase) => DesignUseCase,
): Promise<MutationResult> {
  return mutateUseCases(personaId, (useCases) =>
    useCases.map((uc) => (uc.id === useCaseId ? updater(uc) : uc)),
  );
}

/** Mutate the designFiles section of design_context. */
export function mutateDesignFiles(
  personaId: string,
  updater: (files: DesignFilesSection) => DesignFilesSection,
): Promise<MutationResult> {
  return applyDesignContextMutation(personaId, (ctx) => {
    const data = parseDesignContext(ctx);
    return serializeDesignContext({
      ...data,
      designFiles: updater(data.designFiles ?? { files: [], references: [] }),
    });
  });
}

/** Link a credential to a connector name in design_context. */
export function mutateCredentialLink(
  personaId: string,
  connectorName: string,
  credentialId: string,
): Promise<MutationResult> {
  return applyDesignContextMutation(personaId, (ctx) =>
    mergeCredentialLink(ctx, connectorName, credentialId),
  );
}

// -- React hook for convenience ---------------------------------------

const NO_PERSONA_RESULT: MutationResult = { applied: false, reason: 'No persona selected' };

/**
 * Hook that returns typed mutation helpers bound to the currently selected persona.
 * Components can call these without needing to thread personaId manually.
 */
export function useDesignContextMutator() {
  const personaId = useAgentStore((s) => s.selectedPersona?.id ?? null);
  const pendingCount = usePendingWriteCount();

  const mutateCtx = useCallback(
    (mutator: (ctx: string | null | undefined) => string): Promise<MutationResult> => {
      if (!personaId) return Promise.resolve(NO_PERSONA_RESULT);
      return applyDesignContextMutation(personaId, mutator);
    },
    [personaId],
  );

  const updateUseCases = useCallback(
    (updater: (useCases: DesignUseCase[]) => DesignUseCase[]): Promise<MutationResult> => {
      if (!personaId) return Promise.resolve(NO_PERSONA_RESULT);
      return mutateUseCases(personaId, updater);
    },
    [personaId],
  );

  const updateSingleUseCase = useCallback(
    (useCaseId: string, updater: (uc: DesignUseCase) => DesignUseCase): Promise<MutationResult> => {
      if (!personaId) return Promise.resolve(NO_PERSONA_RESULT);
      return mutateSingleUseCase(personaId, useCaseId, updater);
    },
    [personaId],
  );

  const updateDesignFiles = useCallback(
    (updater: (files: DesignFilesSection) => DesignFilesSection): Promise<MutationResult> => {
      if (!personaId) return Promise.resolve(NO_PERSONA_RESULT);
      return mutateDesignFiles(personaId, updater);
    },
    [personaId],
  );

  const linkCredential = useCallback(
    (connectorName: string, credentialId: string): Promise<MutationResult> => {
      if (!personaId) return Promise.resolve(NO_PERSONA_RESULT);
      return mutateCredentialLink(personaId, connectorName, credentialId);
    },
    [personaId],
  );

  return {
    mutateCtx,
    updateUseCases,
    updateSingleUseCase,
    updateDesignFiles,
    linkCredential,
    pendingWriteCount: pendingCount,
  };
}
