import { useMemo } from 'react';
import type { Persona } from '@/lib/bindings/Persona';

/**
 * Shared sort+search logic for persona picker UIs (PersonaSelector,
 * PersonaSelectorModal). Sorts by name ascending, then filters by a
 * case-insensitive substring match on name.
 */
export function usePersonaPicklist(personas: Persona[], search: string) {
  const sorted = useMemo(
    () => [...personas].sort((a, b) => a.name.localeCompare(b.name)),
    [personas],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [sorted, search]);

  return { sorted, filtered };
}
