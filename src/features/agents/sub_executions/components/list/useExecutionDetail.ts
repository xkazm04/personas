import { useState, useCallback } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

type DetailExecution = PersonaExecution & { persona_name?: string };

/**
 * Row → detail modal. The ledger rows are lean `ExecutionListItem`s; opening
 * one hydrates the full record (shared cache with the compare view) exactly
 * like Overview → Activity does, so both ledgers open the same modal.
 */
export function useExecutionDetail(
  hydrate: (executionId: string) => Promise<PersonaExecution>,
  personaName: string | undefined,
) {
  const [execution, setExecution] = useState<DetailExecution | null>(null);

  const open = useCallback(async (executionId: string) => {
    try {
      const full = await hydrate(executionId);
      setExecution({ ...full, persona_name: personaName });
    } catch (err) {
      toastCatch('execution-list:openDetail')(err);
    }
  }, [hydrate, personaName]);

  const close = useCallback(() => setExecution(null), []);

  return { execution, open, close };
}
