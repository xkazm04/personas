import { useCallback, useEffect, useState } from 'react';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { CreatePersonaResponsibilityInput } from '@/lib/bindings/CreatePersonaResponsibilityInput';
import {
  listPersonaResponsibilities,
  createPersonaResponsibility,
  updatePersonaResponsibility,
  retirePersonaResponsibility,
  setPersonaResponsibilityStatus,
  type ResponsibilityStatusValue,
  type ResponsibilityUpdatePayload,
} from '@/api/agents/responsibilities';
import { responsibilitiesCache } from '@/features/agents/sub_life/lifeCache';
import { silentCatch } from '@/lib/silentCatch';
import type { CharterPatch } from '../components/sigil/dimEditorShell';

/**
 * Build the `update_persona_responsibility` wire payload for a partial edit.
 *
 * On this wire `null` on a REGULAR field means "leave unchanged" (serde
 * `Option` -> `None`), so every field the caller did not touch is sent as
 * `null` rather than omitted. `budgetMonthlyUsd` is the double-`Option`
 * exception where an explicit `null` CLEARS the column — which is why
 * `CharterPatch` types it `number | null` and this function forwards the key
 * only when the caller actually supplied one. `projectId` is never sent:
 * absent = leave unchanged.
 */
function toUpdatePayload(patch: CharterPatch): ResponsibilityUpdatePayload {
  const payload: ResponsibilityUpdatePayload = {
    title: null,
    domain: null,
    outcomes: patch.outcomes ?? null,
    objectives: null,
    scopeRung: null,
    refusalClasses: null,
    approvalGates: patch.approvalGates ?? null,
    owner: null,
    cadence: patch.cadence ?? null,
    tenure: null,
    connectors: patch.connectors ?? null,
    procedure: patch.procedure ?? null,
    spec: patch.spec ?? null,
  };
  if (patch.budgetMonthlyUsd !== undefined) payload.budgetMonthlyUsd = patch.budgetMonthlyUsd;
  return payload;
}

export interface UseChartersResult {
  charters: PersonaResponsibility[];
  isLoading: boolean;
  reload: () => Promise<void>;
  /** Partial edit through the operator door; the merged charter is re-validated
   *  server-side, so an invalid patch rejects rather than storing silently. */
  patchCharter: (id: string, patch: CharterPatch) => Promise<PersonaResponsibility>;
  createCharter: (input: CreatePersonaResponsibilityInput) => Promise<PersonaResponsibility>;
  retireCharter: (id: string) => Promise<PersonaResponsibility>;
  setCharterStatus: (id: string, status: ResponsibilityStatusValue) => Promise<PersonaResponsibility>;
}

/**
 * The Responsibilities tab's charter store. Warm-cached per persona
 * (`responsibilitiesCache`, loading pattern v2 mechanic 4) so a remount after
 * nav-away paints the last fetch instead of re-ghosting.
 *
 * Retired charters ARE fetched: the tab surfaces the whole status ladder, and
 * hiding `retired` rows was the reason the ladder read as a one-way door.
 */
export function useCharters(personaId: string): UseChartersResult {
  const [charters, setCharters] = useState<PersonaResponsibility[]>(
    () => responsibilitiesCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!responsibilitiesCache.has(personaId));

  const reload = useCallback(async () => {
    if (!personaId) {
      setCharters([]);
      setIsLoading(false);
      return;
    }
    try {
      const rows = await listPersonaResponsibilities(personaId, true);
      responsibilitiesCache.set(personaId, rows);
      setCharters(rows);
    } catch (err) {
      silentCatch('responsibilities:list')(err);
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setCharters(responsibilitiesCache.get(personaId) ?? []);
    setIsLoading(!responsibilitiesCache.has(personaId));
    void reload();
  }, [personaId, reload]);

  const absorb = useCallback(
    (saved: PersonaResponsibility) => {
      setCharters((prev) => {
        const next = prev.some((r) => r.id === saved.id)
          ? prev.map((r) => (r.id === saved.id ? saved : r))
          : [saved, ...prev];
        responsibilitiesCache.set(personaId, next);
        return next;
      });
      return saved;
    },
    [personaId],
  );

  const patchCharter = useCallback(
    async (id: string, patch: CharterPatch) =>
      absorb(await updatePersonaResponsibility(id, toUpdatePayload(patch))),
    [absorb],
  );

  const createCharter = useCallback(
    async (input: CreatePersonaResponsibilityInput) => absorb(await createPersonaResponsibility(input)),
    [absorb],
  );

  const retireCharter = useCallback(
    async (id: string) => absorb(await retirePersonaResponsibility(id)),
    [absorb],
  );

  // The door that makes `draft` escapable: an agent-proposed charter is minted
  // as a draft on approval, so activation is what closes the propose-adopt loop.
  const setCharterStatus = useCallback(
    async (id: string, status: ResponsibilityStatusValue) =>
      absorb(await setPersonaResponsibilityStatus(id, status)),
    [absorb],
  );

  return {
    charters,
    isLoading,
    reload,
    patchCharter,
    createCharter,
    retireCharter,
    setCharterStatus,
  };
}
