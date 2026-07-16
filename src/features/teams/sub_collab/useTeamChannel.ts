import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, EMPTY_CHANNEL, type ChannelTeamState } from '@/stores/slices/pipeline/channelSlice';
import type { ChannelKind } from '@/api/pipeline/teamChannel';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * Design B — the real living-chat feed.
 *
 * Server read-model (`list_team_channel`: step layer ∪ bus ∪ memories, keyset
 * pagination) + push: the orchestrator's TEAM_ASSIGNMENT_PROGRESS emit triggers
 * a head refresh the moment any step moves, with a poll fallback for the
 * non-step sources.
 *
 * P0 (monitor consolidation): the state, the fetching, the poll and the push
 * listener all moved into `channelSlice` + `useChannelService`. What's left here
 * are the shared view helpers consumed by the monitor channels (Stream,
 * Conversation), the studio roster and TeamList. Subscribing is refcounted:
 * N surfaces watching the same team share one fetch instead of each running
 * its own poll + listener.
 * -------------------------------------------------------------------------- */

/** Per-team composer-draft storage key prefix. */
export const CHANNEL_DRAFT_PREFIX = 'personas.channel.draft.';

/** Whether a team has an unsent channel draft persisted locally. */
export function hasUnsentDraft(teamId: string): boolean {
  try {
    return !!localStorage.getItem(CHANNEL_DRAFT_PREFIX + teamId)?.trim();
  } catch {
    return false;
  }
}

export type PresenceStatus = 'working' | 'waiting';

/**
 * Presence, derived from the step layer: a persona whose most recent step row
 * is `step_running` is WORKING; one whose latest row is the awaiting-review
 * gate is WAITING. Shared by the channel and the studio roster.
 */
export function derivePresence(items: TeamChannelItem[]): Map<string, PresenceStatus> {
  const latestByStep = new Map<string, TeamChannelItem>();
  for (const i of items) {
    if (i.kind !== 'step' || !i.stepId) continue;
    if (!latestByStep.has(i.stepId)) latestByStep.set(i.stepId, i); // items are newest-first
  }
  const map = new Map<string, PresenceStatus>();
  for (const i of latestByStep.values()) {
    if (!i.personaId) continue;
    if (i.label === 'step_running') map.set(i.personaId, 'working');
    else if (i.label === 'status_awaiting_review' && !map.has(i.personaId)) map.set(i.personaId, 'waiting');
  }
  return map;
}

/**
 * Declare interest in one or more team channels for as long as the caller is
 * mounted. Refcounted in the slice — the first subscriber triggers an immediate
 * fetch, and the shared service keeps every subscribed channel fresh.
 */
export function useChannelSubscription(teamIds: string[], kinds?: ChannelKind[]): void {
  const subscribe = usePipelineStore((s) => s.subscribeChannel);
  // Subscribe by VALUE, not identity — callers routinely pass fresh arrays.
  const key = teamIds.join(',');
  const kindKey = kinds && kinds.length ? [...kinds].sort().join(',') : '';

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const asked = kindKey ? (kindKey.split(',') as ChannelKind[]) : undefined;
    const releases = ids.map((id) => subscribe(id, asked));
    return () => releases.forEach((release) => release());
  }, [key, kindKey, subscribe]);
}

/** One team's cached BLENDED channel state (never undefined). The Stream keys
 *  its own entries by (team, kinds); this hook is always the blended read. */
function useChannelState(teamId: string): ChannelTeamState {
  return usePipelineStore(useShallow((s) => s.channels[channelKey(teamId)] ?? EMPTY_CHANNEL));
}

/**
 * Lean presence-only view for surfaces that don't render the conversation (e.g.
 * the studio roster). Same shared feed as the channel — no separate poll.
 */
export function useTeamPresence(teamId: string): Map<string, PresenceStatus> {
  useChannelSubscription(useMemo(() => [teamId], [teamId]));
  const { items } = useChannelState(teamId);
  return useMemo(() => derivePresence(items), [items]);
}
