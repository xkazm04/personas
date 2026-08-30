// ActivityMessages — the Activity rail's third tab: the last thing every team
// said, in one list.
//
// The Monitor already has two surfaces that answer "what happened": the Timeline
// (the full merged log, its own destination) and Conversations (one project at a
// time, where you write). This is neither — it is the PERIPHERAL read: you are
// looking at the board, something moves, and you want the sentence behind it
// without leaving the board. So it is bounded (RECENT_LIMIT), read-only, and one
// click deep — clicking a row scopes the Monitor to that speaker's Timeline,
// which is the surface that owns the rest of the story.
//
// It reads the SAME shared channel cache the other two surfaces read
// (`useMergedChannels` → refcounted `useChannelSubscription`), so it starts no
// poller of its own; and it is rendered only while its tab is showing, so the
// subscription's refcount drops the moment you switch tabs. That is the whole
// reason the tab bodies are mounted conditionally rather than hidden with CSS.
//
// The row projection is `resolveCompact` — literally the Timeline's own, so a
// step / event / memory / directive / post reads identically in both places and
// a change to one cannot drift from the other.

import { memo } from 'react';
import { MessagesSquare } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { authorName } from '@/features/teams/sub_collab/collabRender';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useTranslation } from '@/i18n/useTranslation';
import { useMergedChannels } from '../channels/mergedFeed';
import { resolveCompact } from '../channels/MergedRow';
import type { FeedTeam, TaggedItem } from '../channels/types';
import { cleanName } from './fleetGridModel';

/** How much of the merged feed the rail shows. It is a peripheral read, not the
 *  log — the Timeline is one click away and is unbounded. */
const RECENT_LIMIT = 60;

const MessageRow = memo(function MessageRow({
  tagged, personaIndex, onOpen,
}: {
  tagged: TaggedItem;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen?: (teamId: string, personaId: string) => void;
}) {
  const { item, team } = tagged;
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const { event, tone, message, alert } = resolveCompact(item);
  const source = authorName(item, persona);
  const clickable = !!onOpen && !!item.personaId;

  const body = (
    <>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ backgroundColor: colorWithAlpha(team.teamColor, 0.65) }}
      />
      <span className="flex items-center gap-1.5">
        {persona ? (
          <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
        ) : (
          <span className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="min-w-0 truncate typo-label text-foreground">{cleanName(source)}</span>
        <span className={`min-w-0 truncate typo-caption ${tone}`}>{event}</span>
        <RelativeTime
          timestamp={item.at}
          showTooltip={false}
          className="ml-auto flex-shrink-0 typo-caption tabular-nums text-foreground opacity-50"
        />
      </span>
      {message && (
        <span className={`mt-0.5 block line-clamp-2 typo-caption ${alert ? 'text-amber-200' : 'text-foreground opacity-60'}`}>
          {message}
        </span>
      )}
    </>
  );

  const className = `relative block w-full border-b border-border px-2.5 py-1.5 pl-3 text-left transition-colors ${
    clickable ? 'hover:bg-secondary/40' : ''
  }`;

  return clickable ? (
    <button
      type="button"
      data-testid="fleet-grid-message-row"
      onClick={() => onOpen?.(team.teamId, item.personaId!)}
      className={className}
    >
      {body}
    </button>
  ) : (
    <div data-testid="fleet-grid-message-row" className={className}>
      {body}
    </div>
  );
});

export function ActivityMessages({
  teams, onOpen,
}: {
  teams: FeedTeam[];
  /** Scope the Monitor's Timeline to this speaker. Absent = rows are inert. */
  onOpen?: (teamId: string, personaId: string) => void;
}) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const { merged } = useMergedChannels(teams);

  if (merged.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <MessagesSquare className="h-6 w-6 text-foreground opacity-40" />
        <p className="typo-caption text-foreground opacity-50">{t.monitor.grid_messages_empty}</p>
      </div>
    );
  }

  return (
    <ul data-testid="fleet-grid-messages" className="flex flex-col">
      {merged.slice(0, RECENT_LIMIT).map((tagged) => (
        <li key={`${tagged.team.teamId}:${tagged.item.id}`}>
          <MessageRow tagged={tagged} personaIndex={personaIndex} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

export default ActivityMessages;
