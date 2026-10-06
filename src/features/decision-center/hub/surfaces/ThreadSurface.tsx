/**
 * ThreadSurface — a chat thread waiting on you, opened where it can be answered.
 *
 *  - `team:<id>`    → `RailThreadModal`, the Monitor's own thread modal (reply
 *    is a channel directive threaded under the latest line). Its thread is
 *    built here from the team channel the roster already subscribed to.
 *  - `persona:<id>` → `PersonaConversation`, the persona channel's own surface
 *    with its own composer, in a modal. `RailThreadModal` cannot carry it: its
 *    reply goes to a TEAM channel, and a persona channel has none.
 *
 * Opening marks the thread seen (the modal's own read-on-view, or the persona
 * conversation's), which is what answers it in the roster's chat predicate.
 */
import { useCallback, useMemo } from 'react';

import { PersonaConversation } from '@/features/fleet/monitor/channels/PersonaConversation';
import type { FeedTeam, TaggedItem } from '@/features/fleet/monitor/channels/types';
import { RailThreadModal } from '@/features/fleet/monitor/grid/rail/RailThreadModal';
import type { MessageThread } from '@/features/fleet/monitor/grid/rail/messageThreads';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey as teamCacheKey } from '@/stores/slices/pipeline/channelSlice';

import type { DecisionItem } from '../../model/decisionModel';

/** The team-channel kinds that are something SAID — `chatThreads`' own set. */
const SAID = new Set(['directive', 'persona', 'athena', 'director', 'slack']);

const PERSONA_TITLE_ID = 'decision-persona-thread-title';

function TeamThread({ teamId, feedTeams, onClose }: { teamId: string; feedTeams: readonly FeedTeam[]; onClose: () => void }) {
  const state = usePipelineStore((s) => s.channels[teamCacheKey(teamId)]);
  const team = usePipelineStore((s) => s.teams.find((tm) => tm.id === teamId));
  const markChannelSeen = usePipelineStore((s) => s.markChannelSeen);

  const thread = useMemo<MessageThread | null>(() => {
    const feed: FeedTeam = feedTeams.find((f) => f.teamId === teamId)
      ?? { teamId, teamName: team?.name ?? teamId, teamColor: team?.color ?? '', members: [] };
    // Newest first — the slice's order, and the order the modal expects.
    const items: TaggedItem[] = (state?.items ?? [])
      .filter((i) => !i.deliberationId && SAID.has(i.kind))
      .map((item) => ({ item, team: feed }));
    const latest = items[0];
    if (!latest) return null;
    return { key: `team:${teamId}`, kind: 'team', name: feed.teamName, personaId: null, items, latest, unread: 0 };
  }, [state, team, feedTeams, teamId]);

  const onMarkRead = useCallback(() => markChannelSeen(teamId), [markChannelSeen, teamId]);
  return <RailThreadModal thread={thread} onClose={onClose} onMarkRead={onMarkRead} />;
}

function PersonaThread({ personaId, onClose }: { personaId: string; onClose: () => void }) {
  const persona = useAgentStore((s) => s.personas.find((p) => p.id === personaId));
  if (!persona) return null;
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={PERSONA_TITLE_ID}
      portal
      maxWidthClass="max-w-2xl"
      staggerChildren={false}
      panelClassName="flex h-[76vh] flex-col overflow-hidden rounded-modal border border-border bg-background shadow-elevation-4"
    >
      <h2 id={PERSONA_TITLE_ID} className="sr-only">{persona.name}</h2>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="decision-persona-thread">
        <PersonaConversation persona={persona} />
      </div>
    </BaseModal>
  );
}

export function ThreadSurface({
  item, feedTeams, onClose,
}: {
  item: DecisionItem;
  feedTeams: readonly FeedTeam[];
  onClose: () => void;
}) {
  const [kind, id] = (item.thread?.channelKey ?? item.sourceId).split(':', 2);
  if (!id) return null;
  if (kind === 'team') return <TeamThread teamId={id} feedTeams={feedTeams} onClose={onClose} />;
  if (kind === 'persona') return <PersonaThread personaId={id} onClose={onClose} />;
  return null;
}
