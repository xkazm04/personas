import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import { listPersonaResponsibilities } from '@/api/agents/responsibilities';
import { responsibilitiesCache } from '@/features/agents/sub_life/lifeCache';
import { parseDesignContext } from '@/features/agents/sub_lab/use-cases/UseCasesList';
import { resolvePersonaCapabilities, type PersonaCapability } from '@/lib/personas/capabilities';
import { silentCatch } from '@/lib/silentCatch';

export interface UsePersonaCapabilitiesOptions {
  /** Raw `design_context` JSON — the pre-migration fallback source. */
  designContext?: string | null;
  /** Persona's wired connector slugs, for the needs-attention derivation. */
  personaConnectors?: ReadonlySet<string>;
  /** Include draft/suspended/retired charters. Default `false` — a read-only
   *  consumer wants the capabilities that are LIVE, not the whole ladder. */
  includeInactive?: boolean;
}

/**
 * READ-ONLY capability list for any persona, through the one door
 * (`resolvePersonaCapabilities`). Charters are fetched over IPC and warm-cached
 * per persona (`responsibilitiesCache`, 5 min TTL), so several consumers on the
 * same screen share one fetch.
 *
 * The Responsibilities tab does NOT use this — it owns writes and needs the
 * full ladder, so it drives `useCharters` instead.
 */
export function usePersonaCapabilities(
  personaId: string | null | undefined,
  options: UsePersonaCapabilitiesOptions = {},
): { capabilities: PersonaCapability[]; charters: PersonaResponsibility[]; isLoading: boolean } {
  const { designContext, personaConnectors, includeInactive = false } = options;
  const [charters, setCharters] = useState<PersonaResponsibility[]>(
    () => (personaId ? responsibilitiesCache.get(personaId) : undefined) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!!personaId && !responsibilitiesCache.has(personaId));

  useEffect(() => {
    if (!personaId) {
      setCharters([]);
      setIsLoading(false);
      return;
    }
    const cached = responsibilitiesCache.get(personaId);
    if (cached) {
      setCharters(cached);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    listPersonaResponsibilities(personaId, true)
      .then((rows) => {
        responsibilitiesCache.set(personaId, rows);
        if (!cancelled) setCharters(rows);
      })
      .catch(silentCatch('usePersonaCapabilities:list'))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const useCases = useMemo(
    () => (designContext === undefined ? [] : parseDesignContext(designContext).useCases ?? []),
    [designContext],
  );

  const capabilities = useMemo(
    () =>
      resolvePersonaCapabilities({
        charters,
        useCases,
        personaConnectors,
        includeInactiveCharters: includeInactive,
      }),
    [charters, useCases, personaConnectors, includeInactive],
  );

  return { capabilities, charters, isLoading };
}

/**
 * The SELECTED persona's live capabilities. Drop-in replacement for the old
 * `useSelectedUseCases()` selector at every call site that only reads
 * `id` / `title` / `modelOverride`.
 */
export function useSelectedPersonaCapabilities(): PersonaCapability[] {
  const selected = useAgentStore((s) => s.selectedPersona);
  return usePersonaCapabilities(selected?.id, { designContext: selected?.design_context ?? null })
    .capabilities;
}
