import { useCallback, useEffect, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { setPersonaStarred } from '@/api/agents/personas';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Persona "favorite" = the DB-backed `starred` flag, which is also the
 * Director's coaching scope (the Director only reviews starred personas).
 * Previously this was localStorage-only; it now reads `persona.starred` from
 * the agent store and persists toggles via `set_persona_starred`.
 */

const LEGACY_KEY = 'personas:favorite-agents';
// Module-level guard so the one-time localStorage→DB import runs at most once
// per app session regardless of how many components mount the hook.
let legacyImportDone = false;

export function useFavoriteAgents() {
  const personas = useAgentStore((s) => s.personas);

  const favorites = useMemo(
    () => new Set(personas.filter((p) => p.starred).map((p) => p.id)),
    [personas],
  );

  // One-time migration of pre-existing localStorage favorites into the DB.
  useEffect(() => {
    if (legacyImportDone || personas.length === 0) return;
    legacyImportDone = true;
    const raw = (() => {
      try {
        return localStorage.getItem(LEGACY_KEY);
      } catch {
        return null;
      }
    })();
    if (!raw) return;
    try {
      const ids = new Set(JSON.parse(raw) as string[]);
      const toStar = personas.filter((p) => ids.has(p.id) && !p.starred);
      if (toStar.length > 0) {
        void Promise.all(toStar.map((p) => setPersonaStarred(p.id, true)))
          .then(() => useAgentStore.getState().fetchPersonas())
          .catch(silentCatch('useFavoriteAgents:migrate'));
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* corrupt legacy value — drop it */
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [personas]);

  const toggleFavorite = useCallback((id: string) => {
    const cur = useAgentStore.getState().personas.find((p) => p.id === id)?.starred ?? false;
    setPersonaStarred(id, !cur)
      .then(() => useAgentStore.getState().fetchPersonas())
      .catch(silentCatch('useFavoriteAgents:toggle'));
  }, []);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}
