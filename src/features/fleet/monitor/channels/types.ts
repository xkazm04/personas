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

/** A team in the Stream's channel facet — a FeedTeam plus its on/off state. */
export interface StreamTeam extends FeedTeam {
  selected: boolean;
}

/**
 * Bound on the LIVE POP-UP feed's window (`mergedFeed`, consumed only by
 * LiveChannelOverlay).
 *
 * This was `MAX_MERGED_ROWS` — a hard cap on the Stream's history that made the
 * log un-scrollable past 600 rows. The Stream no longer goes through this path
 * at all: it reads the shared channel cache and pages a real k-way merge, so its
 * history is unbounded. What's left here is the pop-up overlay, which only needs
 * to diff RECENT arrivals to decide what to pop — for that, a bounded window is
 * the correct design, not a limitation.
 */
export const LIVE_FEED_WINDOW = 600;

/** Row height (px) the virtualizer estimates — keep in sync with the row's
 *  vertical padding/line-height so scroll math is exact. */
export const MERGED_ROW_HEIGHT = 30;
