import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, AlertCircle, Pin } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useTeamChannel } from '@/features/teams/sub_collab/useTeamChannel';
import { parsePayload } from '@/features/teams/sub_redRoom/useRedRoomFeed';
import {
  STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent,
  type ChannelMember,
} from '@/features/teams/sub_collab/collabRender';
import { eventFamily } from '@/features/teams/sub_redRoom/useRedRoomFeed';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * Merge infrastructure for the COMBINED cross-team channel prototypes.
 *
 * `useTeamChannel` is a per-team hook, so a variable number of teams can't be
 * read in a loop. Instead each team gets a hidden `TeamFeed` feeder that calls
 * the hook and reports its items up; `MergedChannels` aggregates them and hands
 * the merged, team-tagged stream to a render-prop child. The combined views are
 * READ-ONLY (click a row → the shared detail modal); full per-team interaction
 * stays in the grid layout.
 * -------------------------------------------------------------------------- */

/** Hard cap on the merged window — bounds memory + keeps the virtualizer cheap
 *  regardless of how many teams are selected. */
const MAX_MERGED_ROWS = 600;

export interface FeedTeam {
  teamId: string;
  teamName: string;
  teamColor: string;
  members: ChannelMember[];
}

export interface TaggedItem {
  item: TeamChannelItem;
  team: FeedTeam;
}

type PresenceMap = Map<string, 'working' | 'waiting'>;

/** Hidden feeder — one per team — that reports its channel items + presence. */
function TeamFeed({ team, onData }: { team: FeedTeam; onData: (teamId: string, items: TeamChannelItem[], presence: PresenceMap) => void }) {
  const { items, presence } = useTeamChannel(team.teamId);
  useEffect(() => {
    onData(team.teamId, items, presence);
  }, [items, presence, team.teamId, onData]);
  return null;
}

export function MergedChannels({
  teams,
  children,
}: {
  teams: FeedTeam[];
  children: (merged: TaggedItem[], presenceByTeam: Map<string, PresenceMap>, byTeam: Map<string, TaggedItem[]>) => ReactNode;
}) {
  const [itemsByTeam, setItemsByTeam] = useState<Map<string, TeamChannelItem[]>>(new Map());
  const [presenceByTeam, setPresenceByTeam] = useState<Map<string, PresenceMap>>(new Map());

  const onData = useCallback((teamId: string, items: TeamChannelItem[], presence: PresenceMap) => {
    setItemsByTeam((prev) => {
      const next = new Map(prev);
      next.set(teamId, items);
      return next;
    });
    setPresenceByTeam((prev) => {
      const next = new Map(prev);
      next.set(teamId, presence);
      return next;
    });
  }, []);

  const { merged, byTeam } = useMemo(() => {
    const flat: TaggedItem[] = [];
    const grouped = new Map<string, TaggedItem[]>();
    for (const team of teams) {
      const rows = (itemsByTeam.get(team.teamId) ?? []).map((item) => ({ item, team }));
      grouped.set(team.teamId, [...rows].sort((a, b) => b.item.at.localeCompare(a.item.at)));
      flat.push(...rows);
    }
    flat.sort((a, b) => b.item.at.localeCompare(a.item.at));
    // Bound the merged window so memory + the virtualizer stay cheap no matter
    // how many teams are selected. The newest MAX_MERGED_ROWS are kept; the
    // virtualized list only ever mounts the visible slice of these.
    return { merged: flat.length > MAX_MERGED_ROWS ? flat.slice(0, MAX_MERGED_ROWS) : flat, byTeam: grouped };
  }, [teams, itemsByTeam]);

  return (
    <>
      {teams.map((t) => (
        <TeamFeed key={t.teamId} team={t} onData={onData} />
      ))}
      {children(merged, presenceByTeam, byTeam)}
    </>
  );
}

/** Resolve the compact event label + tone + one-line message for any item. */
function resolveCompact(item: TeamChannelItem): { event: string; tone: string; message: string | null; artifact: { url: string; label: string } | null; isError: boolean; alert: boolean } {
  if (item.kind === 'step') {
    return {
      event: STEP_VERB[item.label] ?? item.label,
      tone: STEP_TONE[item.label] ?? 'text-foreground/55',
      message: item.body,
      artifact: null,
      isError: item.label === 'step_failed',
      alert: item.label === 'status_awaiting_review' || item.label === 'step_failed',
    };
  }
  if (item.kind === 'event') {
    const { summary, artifact } = parsePayload(item.extra);
    return { event: item.label, tone: FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!, message: summary, artifact, isError: false, alert: false };
  }
  if (item.kind === 'memory') {
    return { event: `memory · ${item.label}`, tone: 'text-amber-300/80', message: item.body, artifact: null, isError: false, alert: false };
  }
  if (item.kind === 'directive') {
    return { event: 'directive', tone: 'text-status-success', message: item.body, artifact: null, isError: false, alert: false };
  }
  const meta = AUTHOR_KIND_META[item.kind as 'persona' | 'athena' | 'director'] ?? AUTHOR_KIND_META.persona;
  return { event: meta.label, tone: meta.tag, message: item.body, artifact: null, isError: false, alert: false };
}

/** Row height (px) the virtualizer estimates — keep in sync with the row's
 *  vertical padding/line-height so scroll math is exact. */
export const MERGED_ROW_HEIGHT = 30;

/**
 * One compact merged-feed row: a team-colour rail + badge, the source persona,
 * the event chip, and a one-line message — clickable to open the full detail.
 * STATIC (no per-row mount animation) because the Timeline virtualizes it:
 * rows mount/unmount as you scroll, so an entry animation would re-fire on
 * every scroll. `memo` keeps re-renders to rows whose props actually changed.
 */
export const MergedRow = memo(function MergedRow({
  tagged,
  showTeam,
  personaIndex,
  onOpen,
}: {
  tagged: TaggedItem;
  showTeam: boolean;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen: (item: TeamChannelItem) => void;
}) {
  const { item, team } = tagged;
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const source = authorName(item, persona);
  const { event, tone, message, artifact, isError, alert } = resolveCompact(item);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="w-full h-full text-left flex items-center gap-2 rounded-card px-2.5 hover:bg-foreground/[0.04] transition-colors"
      style={alert ? { boxShadow: 'inset 2px 0 0 var(--color-status-warning, #f59e0b)' } : { boxShadow: `inset 2px 0 0 ${team.teamColor}` }}
    >
      {showTeam && (
        <span className="inline-flex items-center gap-1 flex-shrink-0 typo-caption text-foreground/60" title={team.teamName}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.teamColor }} />
          <span className="max-w-[88px] truncate">{team.teamName.replace(/^SDLC[ —-]*/i, '') || team.teamName}</span>
        </span>
      )}
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary/60 flex-shrink-0">
        {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" /> : item.kind === 'memory' ? <Pin className="w-3 h-3 text-amber-300/80" /> : alert ? <AlertCircle className="w-3 h-3 text-status-warning" /> : <span className="typo-caption text-foreground/40">·</span>}
      </span>
      <span className="typo-caption font-medium flex-shrink-0 max-w-[110px] truncate" style={{ color: accent }}>{source}</span>
      <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${tone}`}>{event}</span>
      {message && <span className={`typo-caption truncate ${isError ? 'text-status-error/80' : 'text-foreground/55'}`}>{message}</span>}
      {artifact && <span className="inline-flex items-center gap-0.5 typo-caption text-status-info flex-shrink-0"><ExternalLink className="w-3 h-3" />{artifact.label}</span>}
      <span className="ml-auto typo-caption text-foreground/30 flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
    </button>
  );
});
