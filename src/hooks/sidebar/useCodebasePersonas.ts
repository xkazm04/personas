/**
 * Returns the set of persona IDs that have the built-in "codebase" connector
 * attached (i.e. at least one of their tools has `requires_credential_type =
 * "codebase"`). Used by the Agents sidebar to surface personas linked to the
 * currently-active Dev Tools project.
 *
 * The lookup is a single cheap SQL query on the backend; this hook caches
 * the result in component state and refetches when the persona list or any
 * persona's tool set may have changed (signalled by `detailCache` keys
 * shifting after `fetchDetail`).
 */
import { useEffect, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { listPersonasUsingConnector } from '@/api/agents/personas';
import { silentCatch } from '@/lib/silentCatch';

const CODEBASE_CONNECTOR = 'codebase';

export function useCodebasePersonas(): Set<string> {
  const personasLength = useAgentStore((s) => s.personas.length);
  const detailCacheKeys = useAgentStore((s) => Object.keys(s.detailCache).length);
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    listPersonasUsingConnector(CODEBASE_CONNECTOR)
      .then((list) => {
        if (cancelled) return;
        setIds(new Set(list));
      })
      .catch(silentCatch('useCodebasePersonas:listPersonasUsingConnector'));
    return () => { cancelled = true; };
    // Refetch when the persona list grows/shrinks or when a persona's detail
    // (and therefore its tool set) was just refreshed. Cheap on the backend.
  }, [personasLength, detailCacheKeys]);

  return ids;
}
