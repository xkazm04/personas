import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type { Persona, WithPersonaInfo } from "@/lib/types/types";

type PersonaLookup = Map<string, Persona>;

/**
 * Returns a memoized persona lookup Map that only rebuilds when the personas
 * array reference changes.  Consumers should pair this with
 * {@link useEnrichedRecords} (or a local `useMemo`) to join persona info at
 * render time instead of baking it into the store.
 */
export function usePersonaMap(): PersonaLookup {
  const personas = useAgentStore((s) => s.personas);
  return useMemo(
    () => new Map(personas.map((p) => [p.id, p])),
    [personas],
  );
}

/**
 * Enrich an array of records that carry a `persona_id` with live persona info
 * (name, icon, color).  The result is memoized on both the records array and
 * the persona map, so it only recomputes when either dependency changes.
 */
export function useEnrichedRecords<T extends { persona_id: string }>(
  records: T[],
  personaMap: PersonaLookup,
): (T & WithPersonaInfo)[] {
  return useMemo(() => {
    return records.map((r) => {
      const p = personaMap.get(r.persona_id);
      return {
        ...r,
        persona_name: p?.name,
        persona_icon: p?.icon ?? undefined,
        persona_color: p?.color ?? undefined,
      };
    });
  }, [records, personaMap]);
}
