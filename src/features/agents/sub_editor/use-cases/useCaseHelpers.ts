import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';

// Re-export UseCaseItem alias for backward compat
export type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';

/** Find a single use case by ID from raw design_context JSON. */
export function getUseCaseById(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
): DesignUseCase | undefined {
  const data = parseDesignContext(rawDesignContext);
  return data.useCases?.find((uc) => uc.id === useCaseId);
}

/** Get all use cases from raw design_context JSON. */
export function getUseCases(rawDesignContext: string | null | undefined): DesignUseCase[] {
  return parseDesignContext(rawDesignContext).useCases ?? [];
}

/**
 * Apply an updater function to a specific use case inside design_context,
 * returning the re-serialized JSON string.
 */
export function updateUseCaseInContext(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
  updater: (uc: DesignUseCase) => DesignUseCase,
): string {
  const data: DesignContextData = parseDesignContext(rawDesignContext);
  const useCases = data.useCases ?? [];
  const updated = useCases.map((uc) => (uc.id === useCaseId ? updater(uc) : uc));
  return serializeDesignContext({ ...data, useCases: updated });
}

// ── Serialized design_context writes ────────────────────────────
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
  const doWrite = async () => {
    const store = usePersonaStore.getState();
    const persona = store.selectedPersona;
    if (!persona || persona.id !== personaId) return;
    const newContext = mutator(persona.design_context);
    await store.applyPersonaOp(personaId, {
      kind: 'UpdateDesignContext',
      design_context: newContext,
    });
  };
  // Chain onto pending write — errors don't break the chain for subsequent writes
  writeQueue = writeQueue.then(doWrite, doWrite);
  return writeQueue;
}
