import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, EMPTY_CHANNEL, type ChannelTeamState } from '@/stores/slices/pipeline/channelSlice';
import { toEpochUtc } from '@/lib/channel/eventModel';
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
 * Conversation), the studio roster. Subscribing is refcounted:
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
 * A `step_running` row older than this no longer counts as WORKING. The channel
 * cache holds paged history, so without a bound a team whose run died (crashed,
 * was cancelled, machine slept) keeps rendering its roster as "working" forever
 * — the terminal row that would clear it may simply never arrive. Ten minutes
 * matches the runner's own liveness horizon: anything genuinely running emits
 * step traffic well inside it.
 */
export const PRESENCE_WORK_WINDOW_MS = 10 * 60 * 1000;

/**
 * Presence, derived from the step layer: a persona whose most recent step row
 * is `step_running` is WORKING — but only while that row is fresh (see
 * PRESENCE_WORK_WINDOW_MS); one whose latest row is the awaiting-review gate is
 * WAITING. WAITING is deliberately unbounded: a review gate legitimately holds
 * for hours and remains true until a human acts. Shared by the channel and the
 * studio roster.
 */
export function derivePresence(items: TeamChannelItem[], now: number = Date.now()): Map<string, PresenceStatus> {
  const latestByStep = new Map<string, TeamChannelItem>();
  for (const i of items) {
    if (i.kind !== 'step' || !i.stepId) continue;
    if (!latestByStep.has(i.stepId)) latestByStep.set(i.stepId, i); // items are newest-first
  }
  const map = new Map<string, PresenceStatus>();
  for (const i of latestByStep.values()) {
    if (!i.personaId) continue;
    if (i.label === 'step_running') {
      if (now - toEpochUtc(i.at) <= PRESENCE_WORK_WINDOW_MS) map.set(i.personaId, 'working');
    } else if (i.label === 'status_awaiting_review' && !map.has(i.personaId)) {
      map.set(i.personaId, 'waiting');
    }
  }
  return map;
}

/**
 * Last observed activity per persona — the max `at` over every channel row the
 * persona authored, as epoch ms. The heartbeat a roster/map surface renders as
 * "2m ago". Starts at the persona's first visible row of ANY kind (a dispatch
 * step, a message, a memory), so an agent becomes visible the moment it is spun
 * up, not only when it completes something.
 */
export function deriveLastSeen(items: TeamChannelItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of items) {
    if (!i.personaId) continue;
    const t = toEpochUtc(i.at);
    if (t > (map.get(i.personaId) ?? 0)) map.set(i.personaId, t);
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
