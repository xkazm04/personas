// useRailFeeds — the three tabs' data, each reduced to the same `RailRow[]`
// plus the same paging contract, so `RailList` never learns which tab it is
// scrolling.
//
// THE PAGING CONTRACT: `{ rows, loading, hasMore, loadMore, total }`. Three very
// different truths hide behind it, and the differences are stated rather than
// smoothed over, because a rail that pretends a local slice is a server page is
// a rail that will silently stop at 600 rows one day and nobody will know why:
//
//   • Reviews  — REAL server paging. `useUnifiedTriage.loadMore` runs the
//                cross-project keyset query; `backlog.more` is the honest "there
//                is more behind this". `total` is what is loaded so far, which
//                is also what the tab badge should say: badging a number the
//                user cannot reach is worse than badging what is in hand.
//   • Dispatch — the backend returns every undispatched idea in one read, so
//                `loadMore` widens a LOCAL window. `hasMore` is therefore about
//                the window, not the server.
//   • Messages — the shared channel cache is bounded at LIVE_FEED_WINDOW (600)
//                by `useMergedChannels`. Paging is again local, over what the
//                cache holds. Going deeper than that is the Timeline's job and
//                it is one click away; this rail is the peripheral read.
//
// Every feed starts at PAGE rows and grows by PAGE — the list is virtualized, so
// the cost of a large window is scroll math rather than DOM, but an unbounded
// first paint would still make the Monitor's open frame do work nobody asked for.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, countUnread, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useUnifiedTriage } from '@/features/agents/quick-answer/triage/useUnifiedTriage';
import { useTriageCopy } from '@/features/agents/quick-answer/triage/useTriageCopy';
import { kindCopy } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import {
  useAcceptedDispatch,
  type AcceptedDispatch,
} from '@/features/agents/quick-answer/triage/deck/useAcceptedDispatch';
import type {
  TriageItem,
  TriageVerdict,
} from '@/features/agents/quick-answer/triage/triageTypes';
import { useMergedChannels } from '../../channels/mergedFeed';
import type { FeedTeam, TaggedItem } from '../../channels/types';
import { channelToRow, ideaToRow, triageToRow, type RailRow } from './railModel';

/** Rows per page, every feed. Small enough that the first paint is cheap, big
 *  enough that a 320px column is filled past the fold. */
const PAGE = 30;

export interface RailFeed {
  rows: RailRow[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** What the tab badge says. See the paging contract above. */
  total: number;
}

/**
 * Resolve a row id back to the object it was adapted from.
 *
 * `RailRow` is deliberately a projection with no back-pointer — the whole reason
 * `railModel` is React-free and store-free is that a row carries display facts
 * and nothing else. But opening a row has to hand the FULL source to the card
 * that renders it, so the lookup lives here, beside the adapter that built the
 * row, rather than as a payload smuggled through the model.
 */
export type RowResolver<T> = (rowId: string) => T | undefined;

/** Grow-a-window helper — the local half of the paging contract. */
function useWindow(all: RailRow[]): { rows: RailRow[]; hasMore: boolean; loadMore: () => void } {
  const [take, setTake] = useState(PAGE);
  // A shrinking source (a dispatch landed, a team was deselected) must not
  // leave the window stranded past the end, or `hasMore` reads true forever.
  useEffect(() => {
    if (take > all.length && all.length > 0) setTake(Math.max(PAGE, all.length));
  }, [all.length, take]);
  const loadMore = useCallback(() => setTake((n) => n + PAGE), []);
  return {
    rows: useMemo(() => (all.length > take ? all.slice(0, take) : all), [all, take]),
    hasMore: all.length > take,
    loadMore,
  };
}

/**
 * REVIEWS — the unified triage queue, the same one the deck's rail reads.
 *
 * This is the tab's whole point and the reason it stopped being `ReviewsRail`:
 * that component read `list_manual_reviews` alone, so a fleet with zero pending
 * manual reviews rendered "Nothing is waiting on you." while sixty ideas,
 * practices, policy diffs, build questions and finished goals sat undecided one
 * surface away. "Reviews" is the operator's word for all of it.
 */
export function useReviewFeed(): RailFeed & {
  itemById: RowResolver<TriageItem>;
  /** The queue's own verdict door — the same one the deck writes through, so a
   *  verdict recorded from the rail and one recorded from the deck cannot take
   *  different paths to the backend. */
  decide: (item: TriageItem, verdict: TriageVerdict) => Promise<void>;
} {
  const copy = useTriageCopy();
  const { t } = useTranslation();
  const queue = useUnifiedTriage(copy);

  const all = useMemo(
    () => queue.items.map((item) => triageToRow(item, kindCopy(t, item.kind).one)),
    [queue.items, t],
  );

  // `triageToRow` keys the row by `item.id`, so the index is that id straight
  // through. Kept as a Map rather than a `find` because the rail resolves on
  // every open and the queue runs to hundreds of items.
  const index = useMemo(() => new Map(queue.items.map((i) => [i.id, i])), [queue.items]);
  const itemById = useCallback<RowResolver<TriageItem>>((id) => index.get(id), [index]);

  const { decide: queueDecide } = queue;
  const decide = useCallback(
    (item: TriageItem, verdict: TriageVerdict) => queueDecide({ item, verdict }),
    [queueDecide],
  );

  // Server paging, so the window is the server's. `loadMore` is guarded on
  // `backlog.more` by the hook itself; calling it at the end is a no-op.
  return {
    rows: all,
    loading: queue.loading,
    hasMore: queue.backlog.more,
    loadMore: queue.loadMore,
    total: all.length,
    itemById,
    decide,
  };
}

/** DISPATCH — accepted ideas nobody has sent to a runner. The controller is
 *  returned alongside because the bar and the checkboxes need it. */
export function useDispatchFeed(): RailFeed & { ctl: AcceptedDispatch } {
  const { t } = useTranslation();
  const ctl = useAcceptedDispatch({
    resolveErrorMessage: (err) =>
      resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
  });
  const label = t.monitor.grid_rail_tab_dispatch;
  const all = useMemo(() => ctl.rows.map((r) => ideaToRow(r, label)), [ctl.rows, label]);
  const win = useWindow(all);
  return { ...win, loading: ctl.loading, total: ctl.rows.length, ctl };
}

/** MESSAGES — the merged channel feed, plus the unread watermark per team. */
export function useMessageFeed(teams: FeedTeam[]): RailFeed & {
  unread: number;
  itemById: RowResolver<TaggedItem>;
} {
  const { merged } = useMergedChannels(teams);
  const personas = useAgentStore((s) => s.personas);
  const personaOf = useCallback(
    (id: string) => personas.find((p) => p.id === id),
    [personas],
  );

  // Per-key subscription, exactly as `mergedFeed` does it: a whole-map selector
  // would re-derive this rail on every OTHER team's poll.
  const keys = useMemo(() => teams.map((tm) => channelKey(tm.teamId)), [teams]);
  const states = usePipelineStore(useShallow((s) => keys.map((k) => s.channels[k])));
  const seenByTeam = useMemo(() => {
    const m = new Map<string, string | null>();
    teams.forEach((tm, i) => m.set(tm.teamId, states[i]?.lastSeenAt ?? null));
    return m;
  }, [teams, states]);

  const unread = useMemo(
    () => states.reduce((n, st) => n + countUnread(st ?? EMPTY_CHANNEL), 0),
    [states],
  );

  const all = useMemo(
    () => merged.map((tagged) => channelToRow(tagged, personaOf, seenByTeam.get(tagged.team.teamId) ?? null)),
    [merged, personaOf, seenByTeam],
  );

  // `channelToRow` keys rows `${teamId}:${itemId}`; the index is built off the
  // same expression so the two cannot drift apart when either changes.
  const index = useMemo(
    () => new Map(merged.map((tg) => [`${tg.team.teamId}:${tg.item.id}`, tg])),
    [merged],
  );
  const itemById = useCallback<RowResolver<TaggedItem>>((id) => index.get(id), [index]);

  const win = useWindow(all);
  // The cache is filled by the subscription, not by this hook — "loading" here
  // would be a claim it cannot make. An empty feed is empty; the tab says so.
  return { ...win, loading: false, total: merged.length, unread, itemById };
}
