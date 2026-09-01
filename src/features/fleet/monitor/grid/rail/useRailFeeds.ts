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
//
// `active` — WHAT IS GATED, AND WHAT DELIBERATELY IS NOT.
//
// All three feeds stay SUBSCRIBED at all times. That is not an oversight: a tab
// badge is only worth having if it is truthful before the tab is clicked, and a
// badge that quietly freezes because its tab is inactive is a worse defect than
// the work it saves. Measured on the live app (2026-09-01, 60s windows through
// the :17320 perf bridge): the channel subscription's `list_team_channel` fires
// 8×/60s with the Monitor CLOSED as well as OPEN — it is refcounted and shared,
// so dropping this rail's interest buys ZERO IPC and costs the unread badge its
// truth. Unsubscribing was measured, not assumed, and rejected on the numbers.
//
// What `active` gates is the ROW PROJECTION — `RailRow[]` plus the row-id index
// — which is pure presentation for a list that is not on screen. It is the half
// that grows without bound: the messages feed re-maps up to LIVE_FEED_WINDOW
// (600) merged items and rebuilds a 600-entry Map on every channel poll, and
// the review feed re-maps the whole unified queue on every queue change, all
// for two tabs the operator is not looking at. This is the shape of the soak
// regression the pass targets — a fixed load costing more to service as history
// accumulates.
//
// Every badge is therefore read from its SOURCE rather than from the projection
// (`queue.items.length`, `ctl.rows.length`, the channel slice's own unread
// count), so gating the projection cannot make a badge lie. Nothing is cached
// or remembered across the gate: when a tab activates, its rows are derived
// fresh in that same render from the live data the badge was already counting.
// There is no stale window on switch-back, because there is nothing to go
// stale — the gate skips work, it never stores a result.

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

/** Stable empties for an inactive feed. A fresh `[]`/`new Map()` per render would
 *  re-invalidate every memo downstream — the exact cost the gate exists to avoid. */
const NO_ROWS: RailRow[] = [];
const NO_INDEX = new Map<string, never>();

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
export function useReviewFeed(active = true): RailFeed & {
  itemById: RowResolver<TriageItem>;
  /** The queue's own verdict door — the same one the deck writes through, so a
   *  verdict recorded from the rail and one recorded from the deck cannot take
   *  different paths to the backend. */
  decide: (item: TriageItem, verdict: TriageVerdict) => Promise<void>;
} {
  const copy = useTriageCopy();
  const { t } = useTranslation();
  const queue = useUnifiedTriage(copy);

  // The queue itself is NEVER gated — it is what the badge counts. Only the
  // adaptation into rows is, and only while nothing renders them.
  const all = useMemo(
    () =>
      active
        ? queue.items.map((item) => triageToRow(item, kindCopy(t, item.kind).one))
        : NO_ROWS,
    [active, queue.items, t],
  );

  // `triageToRow` keys the row by `item.id`, so the index is that id straight
  // through. Kept as a Map rather than a `find` because the rail resolves on
  // every open and the queue runs to hundreds of items.
  const index = useMemo(
    () => (active ? new Map(queue.items.map((i) => [i.id, i])) : NO_INDEX),
    [active, queue.items],
  );
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
    // From the QUEUE, not from `all`: the badge must say what is in hand whether
    // or not this tab has been projected into rows. Identical value either way —
    // `all` was a 1:1 map of `queue.items` — so the badge did not change meaning.
    total: queue.items.length,
    itemById,
    decide,
  };
}

/** DISPATCH — accepted ideas nobody has sent to a runner. The controller is
 *  returned alongside because the bar and the checkboxes need it. */
export function useDispatchFeed(active = true): RailFeed & { ctl: AcceptedDispatch } {
  const { t } = useTranslation();
  // `useAcceptedDispatch` reads ONCE on mount and never polls, so there is no
  // ongoing fetch here to gate — the badge is already free. Only the projection
  // is gated, for the same reason as the other two.
  const ctl = useAcceptedDispatch({
    resolveErrorMessage: (err) =>
      resolveErrorTranslated(t, err instanceof Error ? err.message : String(err)).message,
  });
  const label = t.monitor.grid_rail_tab_dispatch;
  const all = useMemo(
    () => (active ? ctl.rows.map((r) => ideaToRow(r, label)) : NO_ROWS),
    [active, ctl.rows, label],
  );
  const win = useWindow(all);
  return { ...win, loading: ctl.loading, total: ctl.rows.length, ctl };
}

/** MESSAGES — the merged channel feed, plus the unread watermark per team. */
export function useMessageFeed(teams: FeedTeam[], active = true): RailFeed & {
  unread: number;
  itemById: RowResolver<TaggedItem>;
} {
  // NOT gated — this is the refcounted channel subscription the unread badge is
  // derived from. See the `active` note in the header: dropping it was measured
  // to save no IPC at all (the cache is shared) and would freeze the badge.
  const { merged } = useMergedChannels(teams);
  const personas = useAgentStore((s) => s.personas);
  // Indexed once per roster change rather than an O(personas) `find` per row.
  // `merged` runs to LIVE_FEED_WINDOW (600), so the linear scan made the row
  // projection O(messages × personas) on every channel poll — the same
  // accumulate-and-slow-down shape the gate below addresses.
  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const personaOf = useCallback(
    (id: string) => personaById.get(id),
    [personaById],
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
    () =>
      active
        ? merged.map((tagged) =>
            channelToRow(tagged, personaOf, seenByTeam.get(tagged.team.teamId) ?? null),
          )
        : NO_ROWS,
    [active, merged, personaOf, seenByTeam],
  );

  // `channelToRow` keys rows `${teamId}:${itemId}`; the index is built off the
  // same expression so the two cannot drift apart when either changes.
  const index = useMemo(
    () =>
      active
        ? new Map(merged.map((tg) => [`${tg.team.teamId}:${tg.item.id}`, tg]))
        : NO_INDEX,
    [active, merged],
  );
  const itemById = useCallback<RowResolver<TaggedItem>>((id) => index.get(id), [index]);

  const win = useWindow(all);
  // The cache is filled by the subscription, not by this hook — "loading" here
  // would be a claim it cannot make. An empty feed is empty; the tab says so.
  return { ...win, loading: false, total: merged.length, unread, itemById };
}
