import { useCallback, useState } from 'react';
import { instantAdoptTemplate } from '@/api/templates/templateAdopt';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/bindings/Persona';

// Import the Dev Clone template JSON directly — templateIndex already imports it.
import devCloneTemplate from '../../../../../scripts/templates/development/dev-clone.json';

/**
 * Hook that wraps instantAdoptTemplate for the Dev Clone template.
 *
 * The template is embedded in the bundle via a direct JSON import so we never
 * rely on a remote fetch. `instantAdoptTemplate` atomically creates the persona,
 * registers its tools, and wires its triggers in a single backend transaction.
 */
export function useDevCloneAdoption() {
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const adoptDevClone = useCallback(async (): Promise<Persona | null> => {
    setAdopting(true);
    setError(null);
    try {
      // Pass the template's payload (the design result) as JSON.
      // The dev-clone.json file wraps its design under `payload`.
      const designResultJson = JSON.stringify(devCloneTemplate.payload);
      const result = await instantAdoptTemplate('Dev Clone', designResultJson);

      // Refresh the agent store so the new persona appears in lists.
      await fetchPersonas().catch(() => { /* non-fatal */ });

      addToast('Dev Clone persona adopted successfully.', 'success');
      return result.persona;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addToast(`Dev Clone adoption failed: ${msg}`, 'error');
      return null;
    } finally {
      setAdopting(false);
    }
  }, [addToast, fetchPersonas]);

  return { adoptDevClone, adopting, error };
}
