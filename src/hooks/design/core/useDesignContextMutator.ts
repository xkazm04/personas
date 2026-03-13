import { useCallback } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import {
  parseDesignContext,
  serializeDesignContext,
  mergeCredentialLink,
} from '@/features/shared/components/use-cases/UseCasesList';
import type { DesignFilesSection, DesignUseCase } from '@/lib/types/frontendTypes';

// -- Serialized design_context write queue ----------------------------
//
// design_context is a shared JSON blob. Multiple components (UseCaseDetailPanel,
// DesignTab, PersonaConnectorsTab) can issue concurrent read-modify-write updates.
// Without serialization the last writer wins, silently overwriting other changes.
//
// `applyDesignContextMutation` queues writes so each mutation reads the LATEST
// design_context from the store (after previous writes have landed) before applying.

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Queue a design_context mutation that is applied atomically.
 *
 * @param personaId  - the persona to update
 * @param mutator    - receives the *current* raw design_context and returns the new value
 * @returns a promise that resolves when the write completes
 */
export function applyDesignContextMutation(
  personaId: string,
  mutator: (currentDesignContext: string | null | undefined) => string,
): Promise<void> {
  // Snapshot design_context at enqueue time so the mutation can still apply
  // even if the user switches personas before this queued write executes.
  const snapshotStore = useAgentStore.getState();
  const snapshotPersona = snapshotStore.personas.find((p) => p.id === personaId)
    ?? (snapshotStore.selectedPersona?.id === personaId ? snapshotStore.selectedPersona : null);
  const snapshotContext = snapshotPersona?.design_context;

  const doWrite = async () => {
    const store = useAgentStore.getState();
    // Prefer fresh state if persona is still selected (benefits from prior queued writes).
    // Fall back to the enqueue-time snapshot if the user switched away.
    const freshPersona = store.selectedPersona?.id === personaId ? store.selectedPersona : null;
    const currentContext = freshPersona ? freshPersona.design_context : snapshotContext;
    const newContext = mutator(currentContext);
    await store.applyPersonaOp(personaId, {
      kind: 'UpdateDesignContext',
      design_context: newContext,
    });
  };
  // Chain onto pending write -- errors don't break the chain for subsequent writes
  writeQueue = writeQueue.then(doWrite, doWrite);
  return writeQueue;
}

// -- Typed section mutators -------------------------------------------

/** Mutate the useCases section of design_context. */
export function mutateUseCases(
  personaId: string,
  updater: (useCases: DesignUseCase[]) => DesignUseCase[],
): Promise<void> {
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
): Promise<void> {
  return mutateUseCases(personaId, (useCases) =>
    useCases.map((uc) => (uc.id === useCaseId ? updater(uc) : uc)),
  );
}

/** Mutate the designFiles section of design_context. */
export function mutateDesignFiles(
  personaId: string,
  updater: (files: DesignFilesSection) => DesignFilesSection,
): Promise<void> {
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
): Promise<void> {
  return applyDesignContextMutation(personaId, (ctx) =>
    mergeCredentialLink(ctx, connectorName, credentialId),
  );
}

// -- React hook for convenience ---------------------------------------

/**
 * Hook that returns typed mutation helpers bound to the currently selected persona.
 * Components can call these without needing to thread personaId manually.
 */
export function useDesignContextMutator() {
  const personaId = useAgentStore((s) => s.selectedPersona?.id ?? null);

  const mutateCtx = useCallback(
    (mutator: (ctx: string | null | undefined) => string) => {
      if (!personaId) return Promise.resolve();
      return applyDesignContextMutation(personaId, mutator);
    },
    [personaId],
  );

  const updateUseCases = useCallback(
    (updater: (useCases: DesignUseCase[]) => DesignUseCase[]) => {
      if (!personaId) return Promise.resolve();
      return mutateUseCases(personaId, updater);
    },
    [personaId],
  );

  const updateSingleUseCase = useCallback(
    (useCaseId: string, updater: (uc: DesignUseCase) => DesignUseCase) => {
      if (!personaId) return Promise.resolve();
      return mutateSingleUseCase(personaId, useCaseId, updater);
    },
    [personaId],
  );

  const updateDesignFiles = useCallback(
    (updater: (files: DesignFilesSection) => DesignFilesSection) => {
      if (!personaId) return Promise.resolve();
      return mutateDesignFiles(personaId, updater);
    },
    [personaId],
  );

  const linkCredential = useCallback(
    (connectorName: string, credentialId: string) => {
      if (!personaId) return Promise.resolve();
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
  };
}
