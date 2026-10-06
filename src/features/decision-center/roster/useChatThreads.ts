/**
 * useChatThreads — the chat chip, derived from the team-channel and
 * persona-channel slices (see `chatThreads` for the predicate).
 *
 * Counting reads only what the slices already hold, so a reader that wants
 * just the number costs nothing. Asking for the chip (`active`) makes the
 * slices hold more: every team's blended channel is subscribed (the shared
 * channel service then keeps it live), persona previews are read once, and
 * every persona whose newest line is newer than its watermark is subscribed so
 * its thread tail is real rather than guessed from a one-line preview. All of
 * it goes through the slices' own refcounted subscriptions and is released
 * when the chip is no longer asked for.
 *
 * "Done" on a thread advances the slice's own watermark (`markChannelSeen` /
 * `markPersonaChannelSeen`) — a local write with no backend round-trip.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { usePipelineStore } from '@/stores/pipelineStore';
import { useAgentStore } from '@/stores/agentStore';
import { channelKey as teamCacheKey } from '@/stores/slices/pipeline/channelSlice';
import { readPersonaLastSeen } from '@/stores/slices/pipeline/personaChannelSlice';
import { silentCatch } from '@/lib/silentCatch';

import type { DecisionItem } from '../model/decisionModel';
import {
  chatThreadToDecision,
  isAwaitingYou,
  personaThreadMessages,
  teamThreadMessages,
  type ThreadSource,
} from './chatThreads';
import type { DecisionCopy } from './decisionCopy';

export interface ChatThreadsState {
  /** Threads awaiting you among those the slices hold. */
  count: number;
  items: DecisionItem[];
  /** The derivation itself threw — chat fails alone, never zero. */
  failed: boolean;
  /** Advance a thread's watermark. `team:<id>` | `persona:<id>`. */
  markSeen: (channelKey: string) => Promise<void>;
}

export function useChatThreads(active: boolean, copy: DecisionCopy): ChatThreadsState {
  const { channels, personaChannels, previews, teams } = usePipelineStore(
    useShallow((s) => ({
      channels: s.channels,
      personaChannels: s.personaChannels,
      previews: s.personaChannelPreviews,
      teams: s.teams,
    })),
  );
  const personas = useAgentStore((s) => s.personas);
  const subscribeChannel = usePipelineStore((s) => s.subscribeChannel);
  const subscribePersonaChannel = usePipelineStore((s) => s.subscribePersonaChannel);
  const loadPreviews = usePipelineStore((s) => s.loadPersonaChannelPreviews);
  const markChannelSeen = usePipelineStore((s) => s.markChannelSeen);
  const markPersonaChannelSeen = usePipelineStore((s) => s.markPersonaChannelSeen);

  // By VALUE: the stores hand out fresh arrays, and a resubscribe per render
  // would tear every channel down and rebuild it.
  const teamIdsKey = useMemo(() => teams.map((t) => t.id).join(','), [teams]);
  const personaIdsKey = useMemo(() => personas.map((p) => p.id).join(','), [personas]);

  useEffect(() => {
    if (!active || !teamIdsKey) return;
    const releases = teamIdsKey.split(',').map((id) => subscribeChannel(id));
    return () => releases.forEach((release) => release());
  }, [active, teamIdsKey, subscribeChannel]);

  useEffect(() => {
    if (!active || !personaIdsKey) return;
    loadPreviews(personaIdsKey.split(',')).catch(silentCatch('decisionCenter.chatPreviews'));
  }, [active, personaIdsKey, loadPreviews]);

  /** Personas whose newest line (any kind, not the user's) is past the watermark. */
  const stirringKey = useMemo(() => {
    const ids: string[] = [];
    for (const [id, preview] of Object.entries(previews)) {
      if (!preview || (preview.kind === 'chat' && preview.authorKind === 'user')) continue;
      const seen = readPersonaLastSeen(id);
      if (seen === null || preview.at > seen) ids.push(id);
    }
    return ids.sort().join(',');
  }, [previews]);

  useEffect(() => {
    if (!active || !stirringKey) return;
    const releases = stirringKey.split(',').map((id) => subscribePersonaChannel(id));
    return () => releases.forEach((release) => release());
  }, [active, stirringKey, subscribePersonaChannel]);

  const derived = useMemo(() => {
    try {
      const personaById = new Map(personas.map((p) => [p.id, p]));
      const nameOf = (id: string) => personaById.get(id)?.name;
      const sources: ThreadSource[] = [];
      for (const team of teams) {
        const state = channels[teamCacheKey(team.id)];
        if (!state?.loaded) continue;
        sources.push({
          channelKey: `team:${team.id}`,
          title: team.name,
          color: team.color,
          personaId: null,
          messages: teamThreadMessages(state.items),
          seenAt: state.lastSeenAt,
          canReply: true,
        });
      }
      for (const [personaId, state] of Object.entries(personaChannels)) {
        if (!state.loaded) continue;
        const persona = personaById.get(personaId);
        sources.push({
          channelKey: `persona:${personaId}`,
          title: persona?.name ?? personaId,
          color: persona?.color ?? null,
          personaId,
          messages: personaThreadMessages(state.items, personaId),
          seenAt: state.lastSeenAt,
          canReply: true,
        });
      }
      const items: DecisionItem[] = [];
      for (const source of sources) {
        if (!isAwaitingYou(source.messages, source.seenAt)) continue;
        const item = chatThreadToDecision(source, copy, nameOf);
        if (item) items.push(item);
      }
      return { count: items.length, items, failed: false };
    } catch (err) {
      silentCatch('decisionCenter.chatDerivation')(err);
      return { count: 0, items: [] as DecisionItem[], failed: true };
    }
  }, [channels, personaChannels, teams, personas, copy]);

  const markSeen = useCallback(
    async (key: string) => {
      const [kind, id] = key.split(':', 2);
      if (!id) throw new Error(`Not a thread key: ${key}`);
      if (kind === 'team') markChannelSeen(id);
      else if (kind === 'persona') markPersonaChannelSeen(id);
      else throw new Error(`Not a thread key: ${key}`);
    },
    [markChannelSeen, markPersonaChannelSeen],
  );

  return { ...derived, markSeen };
}
