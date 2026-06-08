import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* Shared types for the monitor's combined cross-team channel views. */

/** A team feeding the combined stream — id, label, colour, and its roster. */
export interface FeedTeam {
  teamId: string;
  teamName: string;
  teamColor: string;
  members: ChannelMember[];
}

/** A channel item tagged with the team it came from. */
export interface TaggedItem {
  item: TeamChannelItem;
  team: FeedTeam;
}

/** Presence per persona-id, as reported by `useTeamChannel`. */
export type PresenceMap = Map<string, 'working' | 'waiting'>;

/** Noise filter for the merged stream. */
export type FeedFilter = 'all' | 'signal' | 'alerts';

/** Hard cap on the merged window — bounds memory + keeps the virtualizer cheap
 *  regardless of how many teams are selected. */
export const MAX_MERGED_ROWS = 600;

/** Row height (px) the virtualizer estimates — keep in sync with the row's
 *  vertical padding/line-height so scroll math is exact. */
export const MERGED_ROW_HEIGHT = 30;
