/**
 * Lane "history" — everything already filed, newest first.
 *
 * This is the reading surface the Hub exists for ("check history and react"):
 * approved and rejected memories carrying their verdict and its reason, plus
 * the message log. Rows are `HubEntryRow`, so every inline affordance the rest
 * of the desk offers is here too — a message can still be saved as a fact from
 * the row it is read on.
 *
 * Scale: the lane CAPS its render at `HISTORY_RENDER_CAP` and says so in one
 * line rather than windowing, for the reason recorded on that constant.
 */

import { useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { HubEntryRow } from '../HubEntryRow';
import type { HubDeskProps } from '../hubContract';
import {
  HISTORY_RENDER_CAP, HUB_HISTORY_FILTERS, historyEntries, type HubHistoryFilter,
} from './laneModel';

export function HistoryLane({ feed }: HubDeskProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const [filter, setFilter] = useState<HubHistoryFilter>('all');
  const enter = useRevealTracker(filter);

  const filtered = useMemo(() => historyEntries(feed.entries, filter), [feed.entries, filter]);
  const shown = filtered.slice(0, HISTORY_RENDER_CAP);
  const nothingFiled = useMemo(() => historyEntries(feed.entries, 'all').length === 0, [feed.entries]);

  const options = HUB_HISTORY_FILTERS.map((value) => ({ value, label: t.history[value] }));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Verdict filter ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap px-4 md:px-6 xl:px-8 py-2 border-b border-border">
        <ListFilter className="w-3.5 h-3.5 text-foreground" />
        <PillGroup
          options={options}
          value={filter}
          onChange={setFilter}
          layoutId="hub-history-filter"
          labelClass="typo-caption"
          data-testid="hub-history-filter"
        />
        <span className="ml-auto typo-caption text-foreground tabular-nums">
          {filtered.length > HISTORY_RENDER_CAP
            ? tx(t.history.capped, { shown: HISTORY_RENDER_CAP, total: filtered.length })
            : tx(t.history.total, { total: filtered.length })}
        </span>
      </div>

      {/* ── The filed rows ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3">
        {feed.loading && shown.length === 0 ? (
          <HistoryGhost />
        ) : nothingFiled ? (
          <EmptyState variant="no-results" title={t.history.emptyTitle} subtitle={t.history.emptySubtitle} />
        ) : shown.length === 0 ? (
          <p className="typo-caption text-foreground">{t.history.emptyFiltered}</p>
        ) : (
          <ul className="space-y-1.5 max-w-4xl">
            {shown.map((entry, i) => (
              <HubEntryRow key={entry.id} entry={entry} feed={feed} order={i} enter={enter} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Calm, geometry-matched ghost beneath the permanent filter bar. */
function HistoryGhost() {
  return (
    <ul className="space-y-1.5 max-w-4xl" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-start gap-2 rounded-card border border-border bg-card/40 px-3 py-2 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}>
          <span className="w-5 h-5 rounded-full bg-primary/[0.06] flex-shrink-0" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/3 rounded bg-primary/[0.06]" />
            <span className="block h-3 w-3/4 rounded bg-primary/[0.06]" />
          </span>
        </li>
      ))}
    </ul>
  );
}
