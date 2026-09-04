import { useCallback, useEffect, useRef, useState } from 'react';
import { getPersonaManifest, updatePersonaManifestLaw } from '@/api/agents/personaBrain';
import {
  applyPersonaMemoryReviewProposal,
  discardPersonaMemoryReviewProposal,
  listPersonaMemoryReviewProposals,
} from '@/api/overview/memories';
import type { MemoryReviewProposal } from '@/lib/bindings/MemoryReviewProposal';
import type { PersonaManifestView } from '@/lib/bindings/PersonaManifestView';
import { silentCatch } from '@/lib/silentCatch';
import { manifestCache, manifestProposalsCache } from './manifestCache';

/** The proposal family that edits the self-model half of the manifest. */
export const SELF_MODEL_DIFF_KIND = 'self_model_diff';

export interface ManifestState {
  view: PersonaManifestView | null;
  /** Pending `self_model_diff` proposals, newest-first as the server lists them. */
  proposals: MemoryReviewProposal[];
  isLoading: boolean;
  /** Replace one law section's body and refresh the document. */
  saveLaw: (section: string, content: string) => Promise<void>;
  /** Accept (apply) or reject (discard) one pending proposal, then refresh. */
  decide: (proposalId: string, accept: boolean) => Promise<void>;
}

/**
 * The Manifest tab's data: the document itself plus the proposals waiting to
 * change its self-model half. Both are refetched together after any write, so
 * an accepted diff and the text it produced can never disagree on screen.
 */
export function useManifest(personaId: string): ManifestState {
  const [view, setView] = useState<PersonaManifestView | null>(
    () => manifestCache.get(personaId) ?? null,
  );
  const [proposals, setProposals] = useState<MemoryReviewProposal[]>(
    () => manifestProposalsCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!manifestCache.has(personaId));
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [next, rows] = await Promise.all([
        getPersonaManifest(personaId),
        listPersonaMemoryReviewProposals(personaId, true),
      ]);
      const diffs = rows.filter((r) => r.kind === SELF_MODEL_DIFF_KIND);
      manifestCache.set(personaId, next);
      manifestProposalsCache.set(personaId, diffs);
      if (!alive.current) return;
      setView(next);
      setProposals(diffs);
    } catch (err) {
      silentCatch('manifest:load')(err);
    } finally {
      if (alive.current) setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    alive.current = true;
    setView(manifestCache.get(personaId) ?? null);
    setProposals(manifestProposalsCache.get(personaId) ?? []);
    setIsLoading(!manifestCache.has(personaId));
    void load();
    return () => {
      alive.current = false;
    };
  }, [personaId, load]);

  // Both writers rethrow: the caller is an AsyncButton, and swallowing here
  // would leave a failed save looking exactly like a successful one.
  const saveLaw = useCallback(
    async (section: string, content: string) => {
      await updatePersonaManifestLaw(personaId, section, content);
      await load();
    },
    [personaId, load],
  );

  const decide = useCallback(
    async (proposalId: string, accept: boolean) => {
      if (accept) await applyPersonaMemoryReviewProposal(proposalId);
      else await discardPersonaMemoryReviewProposal(proposalId);
      await load();
    },
    [load],
  );

  return { view, proposals, isLoading, saveLaw, decide };
}
