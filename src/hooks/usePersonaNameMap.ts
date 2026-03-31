import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';

/**
 * Returns an O(1) persona-id → name lookup function backed by a memoized Map.
 * Falls back to the first 8 chars of the id when the persona is not found.
 */
export function usePersonaNameMap() {
  const personas = useAgentStore((s) => s.personas);

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) {
      map.set(p.id, p.name);
    }
    return map;
  }, [personas]);

  return useMemo(
    () => (id: string) => nameMap.get(id) ?? id.slice(0, 8),
    [nameMap],
  );
}
