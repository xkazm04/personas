import { useMemo } from 'react';
import { CONNECTOR_META } from '@/features/shared/components/display/ConnectorMeta';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { useAgentStore } from '@/stores/agentStore';
import { resolveEligibility } from './eligibility';
import type { Recipe, Eligibility } from './types';

/**
 * Connectors the user *can* wire on this setup.
 *
 * v1: full `CONNECTOR_META` keyset — no tier/platform gating yet. When tier
 * gating arrives, intersect with the current tier's permitted connectors;
 * the resolver below short-circuits to `incompatible` when a required
 * connector is missing from this set, so tier-locked recipes display
 * correctly without any other plumbing.
 */
export function useAvailableConnectors(): ReadonlySet<string> {
  return useMemo(() => new Set(Object.keys(CONNECTOR_META)), []);
}

/**
 * Connectors wired on the currently-selected persona.
 *
 * Source: `design_context.credentialLinks` is `Record<string, string>`
 * mapping connector slug → credential ID. Keys = wired connector slugs.
 * This is the same surface the existing tools/agents code uses to
 * determine "is this credential bound to this persona", so eligibility
 * stays in lock-step with whatever the user did in the connectors tab.
 *
 * Returns an empty set when no persona is selected; callers should handle
 * that case (typically by showing recipes without per-persona verdicts).
 */
export function usePersonaConnectors(): ReadonlySet<string> {
  const credentialLinks = useSelectedCredentialLinks();
  return useMemo(
    () => new Set(Object.keys(credentialLinks ?? {})),
    [credentialLinks],
  );
}

/** True when the catalog is being viewed without a selected persona — used
 *  by the browse UI to hide eligibility chips and show a generic CTA. */
export function useNoPersonaSelected(): boolean {
  return useAgentStore((s) => s.selectedPersona === null || s.selectedPersona === undefined);
}

/** Resolve eligibility for a single recipe against the current persona. */
export function useRecipeEligibility(recipe: Recipe): Eligibility {
  const personaConnectors = usePersonaConnectors();
  const availableConnectors = useAvailableConnectors();
  return useMemo(
    () => resolveEligibility(recipe, personaConnectors, availableConnectors),
    [recipe, personaConnectors, availableConnectors],
  );
}

/**
 * Batch resolution for the whole catalog. Use in browse list to drive
 * filter chips ("Eligible (5)" / "Setup needed (3)") and sort.
 *
 * Memoised on the input recipes array reference + persona/available sets,
 * so passing a stable `MOCK_RECIPES` array (or any memoised list) means
 * the resolver runs once per persona switch.
 */
export function useRecipeEligibilityMap(recipes: Recipe[]): Map<string, Eligibility> {
  const personaConnectors = usePersonaConnectors();
  const availableConnectors = useAvailableConnectors();
  return useMemo(() => {
    const map = new Map<string, Eligibility>();
    for (const r of recipes) {
      map.set(r.id, resolveEligibility(r, personaConnectors, availableConnectors));
    }
    return map;
  }, [recipes, personaConnectors, availableConnectors]);
}
