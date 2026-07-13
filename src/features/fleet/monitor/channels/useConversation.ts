import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import { useChannelSubscription } from '@/features/teams/sub_collab/useTeamChannel';
import { listTeamDeliberations } from '@/api/pipeline/teamDeliberations';
import { createTeamAssignment, startTeamAssignment } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import { buildConversation, type AssignProposal, type ConversationRow } from './conversationModel';

/* ----------------------------------------------------------------------------
 * ONE TEAM'S CONVERSATION — data for both variants.
 *
 * Reads the shared channel cache (P0) at TWO keys: the blended conversation, and
 * the deliberation turns, which P1 made opt-in precisely so they'd stop leaking
 * into the chat. Merging them here is a deliberate act, not an accident — the
 * conversation WANTS the turns (D1: capability work and improvement dialog
 * interleave), it just wants them clustered into one card rather than sprayed
 * across the timeline as anonymous persona posts.
 * -------------------------------------------------------------------------- */

const DELIB_KINDS = ['deliberation'] as const;

export function useConversation(teamId: string | null) {
  const ids = useMemo(() => (teamId ? [teamId] : []), [teamId]);
  useChannelSubscription(ids);
  useChannelSubscription(ids, [...DELIB_KINDS]);

  const channels = usePipelineStore((s) => s.channels);
  const loadOlderChannel = usePipelineStore((s) => s.loadOlderChannel);
  const sendChannelDirective = usePipelineStore((s) => s.sendChannelDirective);
  const markChannelSeen = usePipelineStore((s) => s.markChannelSeen);
  const refreshChannel = usePipelineStore((s) => s.refreshChannel);

  const [deliberations, setDeliberations] = useState<TeamDeliberation[]>([]);
  const [proposals, setProposals] = useState<AssignProposal[]>([]);

  const talk = teamId ? channels[channelKey(teamId)] ?? EMPTY_CHANNEL : EMPTY_CHANNEL;
  const turns = teamId ? channels[channelKey(teamId, [...DELIB_KINDS])] ?? EMPTY_CHANNEL : EMPTY_CHANNEL;

  // The deliberation OBJECTS (topic, status, round, cost) — the turns alone
  // don't carry them.
  useEffect(() => {
    if (!teamId) {
      setDeliberations([]);
      return;
    }
    let cancelled = false;
    listTeamDeliberations(teamId)
      .then((d) => {
        if (!cancelled) setDeliberations(d);
      })
      .catch(silentCatch('conversation:deliberations'));
    return () => {
      cancelled = true;
    };
  }, [teamId, turns.items.length]);

  const delibIndex = useMemo(() => {
    const m = new Map<string, TeamDeliberation>();
    for (const d of deliberations) m.set(d.id, d);
    return m;
  }, [deliberations]);

  const rows: ConversationRow[] = useMemo(() => {
    const merged = [...talk.items, ...turns.items].sort(
      (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
    );
    const base = buildConversation(merged);
    // Pending proposals are local-only until Confirm creates the assignment, so
    // they append at the end rather than living in the channel.
    for (const p of proposals) {
      base.push({ kind: 'proposal', key: `prop:${p.goal}`, at: new Date().toISOString(), proposal: p });
    }
    return base;
  }, [talk.items, turns.items, proposals]);

  const loadOlder = useCallback(() => {
    if (teamId) void loadOlderChannel(channelKey(teamId));
  }, [teamId, loadOlderChannel]);

  const send = useCallback(
    (text: string) => {
      if (teamId) void sendChannelDirective(teamId, text).catch(silentCatch('conversation:send'));
    },
    [teamId, sendChannelDirective],
  );

  const addProposal = useCallback((p: AssignProposal) => setProposals((ps) => [...ps, p]), []);
  const dropProposal = useCallback(
    (goal: string) => setProposals((ps) => ps.filter((p) => p.goal !== goal)),
    [],
  );

  /** Confirm → the proposal becomes a real, running assignment. */
  const confirmProposal = useCallback(
    async (p: AssignProposal) => {
      if (!teamId) return;
      setProposals((ps) => ps.map((x) => (x.goal === p.goal ? { ...x, status: 'launching' } : x)));
      try {
        const created = await createTeamAssignment({
          teamId,
          title: p.goal.slice(0, 60),
          goal: p.goal,
          matchStrategy: 'llm_eval',
          maxParallelSteps: 16,
          source: 'team_ui',
          companionOpId: null,
          goalId: null,
          steps: p.steps.map((s) => ({
            title: s.title,
            description: s.description,
            // Personas are re-resolved at run time — the preview's suggestion is
            // a routing hint, not a binding (this mirrors the old console).
            assignedPersonaId: null,
            assignedUseCaseId: null,
            dependsOnIndices: null,
          })),
        });
        if (created) {
          await startTeamAssignment(created.id);
          // The assignment now speaks for itself in the channel.
          setProposals((ps) => ps.filter((x) => x.goal !== p.goal));
          void refreshChannel(channelKey(teamId));
        }
      } catch (e) {
        silentCatch('conversation:confirm')(e);
        setProposals((ps) => ps.map((x) => (x.goal === p.goal ? { ...x, status: 'pending' } : x)));
      }
    },
    [teamId, refreshChannel],
  );

  const markSeen = useCallback(() => {
    if (teamId) markChannelSeen(teamId);
  }, [teamId, markChannelSeen]);

  return {
    rows,
    delibIndex,
    loaded: talk.loaded,
    posting: talk.posting,
    hasMore: !talk.exhausted,
    loadOlder,
    send,
    markSeen,
    addProposal,
    dropProposal,
    confirmProposal,
  };
}
