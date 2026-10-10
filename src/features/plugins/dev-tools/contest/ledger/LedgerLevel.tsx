// Level 1, the ledger: every contest on one line, grouped by what it asks of
// the owner. This file owns the shell — the attention bar, the column header,
// the empty/error/ghost states and the grouping. The row itself is
// `LedgerRow.tsx`, the verdict cell `LedgerVerdict.tsx`, the furniture
// `LedgerChrome.tsx`, and how much of the list is in the DOM `useLedgerWindow`.
import { Fragment, useMemo, type RefObject } from 'react';
import { Plus, Trophy } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import type { ContestStrings } from '../model/labels';
import { attentionOf, keyOf, ledgerCounts, monthOf, type LedgerFilter } from './ledgerModel';
import type { LedgerGroup } from './ledgerModel';
import type { LedgerPageGroup } from './ledgerPaging';
import { LedgerGhost, LedgerWindowFoot, LiveLine, SeasonFoot } from './LedgerChrome';
import { LedgerRow } from './LedgerRow';
import type { LedgerPager } from './useLedgerWindow';
import { cssVars, formatMonth } from './parts';

export interface LedgerLevelProps {
  contests: ContestSummary[];
  /** The window's groups — grouped and sorted over the WHOLE set upstream. */
  groups: LedgerPageGroup[];
  pager: LedgerPager;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  filter: LedgerFilter | null;
  query: string;
  onFilter: (f: LedgerFilter | null) => void;
  onClear: () => void;
  focusKey: string | null;
  onOpen: (key: string, from: HTMLElement | null) => void;
  onFocusRow: (key: string) => void;
  onStandings: () => void;
  onNewContest: () => void;
  rowRefs: RefObject<Map<string, HTMLDivElement>>;
  nowMs: number;
  wide: boolean;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
}

export function LedgerLevel(props: LedgerLevelProps) {
  const { contests, groups, pager, isLoading, error, onRetry, filter, query, onFilter, onClear, nowMs } = props;
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const L = s.ledger;
  const counts = useMemo(() => ledgerCounts(contests), [contests]);

  const seg = (id: LedgerFilter, label: string, n: number, tone: string) => (
    <Button
      key={id}
      variant="ghost"
      className={`att-seg${filter === id ? ' on' : ''}${n ? '' : ' zero'}`}
      style={cssVars({ '--t': tone })}
      aria-pressed={filter === id}
      onClick={() => onFilter(filter === id ? null : id)}
      data-testid={`ledger-filter-${id}`}
    >
      <i className="tdot" style={cssVars({ '--t': tone })} aria-hidden />
      {label}
      <b>{n}</b>
    </Button>
  );

  // Row index across the whole window, so a page's rows cascade 0..19 in
  // reading order regardless of which group they land in.
  let rowIndex = 0;

  return (
    <>
      <div className="att" role="toolbar" aria-label={L.att_label}>
        {seg('yours', L.att_yours, counts.review, 'var(--status-warning)')}
        {seg('running', L.att_running, counts.running, 'var(--status-processing)')}
        {seg('scheduled', L.att_scheduled, counts.scheduled, 'var(--status-info)')}
        {(filter || query) && (
          <>
            <span className="att-div" aria-hidden />
            <Button variant="ghost" className="att-clear" onClick={onClear} data-testid="ledger-clear-filter">
              {L.clear_filter}
            </Button>
          </>
        )}
        <div className="att-live" data-testid="ledger-live">
          <LiveLine contests={contests} nowMs={nowMs} L={L} />
        </div>
      </div>
      <div className="ledger" role="grid" aria-label={L.ledger_label} data-testid="ledger">
        <div className="lcols" role="row">
          <span role="columnheader">{L.col_phase}</span>
          <span role="columnheader">{L.col_contest}</span>
          <span role="columnheader">{L.col_run}</span>
          <span role="columnheader">{L.col_variants}</span>
          <span role="columnheader">{L.col_verdict}</span>
          {props.wide && <span role="columnheader" className="c-wall">{L.col_wall}</span>}
          <span role="columnheader">{L.col_cost}</span>
        </div>
        {error != null && contests.length === 0 ? (
          <div className="lempty">
            <ErrorBanner
              variant="inline"
              message={tx(L.load_failed, { message: resolveErrorTranslated(t, extractMessage(error)).message })}
              onRetry={onRetry}
            />
          </div>
        ) : isLoading && contests.length === 0 ? (
          <LedgerGhost />
        ) : contests.length === 0 ? (
          <div className="lempty">
            <EmptyState icon={Trophy} title={L.none_title} subtitle={L.none_body} action={{ label: L.new_contest, onClick: props.onNewContest, icon: Plus }} />
          </div>
        ) : groups.length === 0 ? (
          <div className="lempty" data-testid="ledger-no-match">
            <b>{L.empty_title}</b>
            {query ? tx(L.empty_query, { query }) : L.empty_filter} {L.empty_clear}
          </div>
        ) : (
          <>
            {groups.map((g) => {
              const at = rowIndex;
              rowIndex += g.families.reduce((n, f) => n + f.items.length, 0);
              return <GroupRows key={g.attention} group={g} firstRowIndex={at} {...props} s={s} />;
            })}
            <LedgerWindowFoot pager={pager} />
            <SeasonFoot contests={contests} onStandings={props.onStandings} L={L} />
          </>
        )}
      </div>
    </>
  );
}

const GROUP_TONE = { yours: 'var(--status-warning)', live: 'var(--status-processing)', settled: 'var(--status-neutral)' } as const;

function GroupRows({
  group, s, firstRowIndex, ...props
}: LedgerLevelProps & { group: LedgerPageGroup; firstRowIndex: number; s: ContestStrings }) {
  const { language, tx } = useTranslation();
  const L = s.ledger;
  const label = group.attention === 'yours' ? L.group_yours : group.attention === 'live' ? L.group_live : L.group_settled;
  let month: string | null = null;
  let i = firstRowIndex;
  return (
    <div role="rowgroup" aria-label={label}>
      <div className="lgrp" style={cssVars({ '--t': GROUP_TONE[group.attention] })}>
        <i className="gdot" aria-hidden />
        {label}
        <span className="n">
          {group.own}
          {group.related > 0 && ` · ${tx(group.related === 1 ? L.group_related_one : L.group_related_other, { count: group.related })}`}
        </span>
      </div>
      {group.families.map((f) => {
        let header = null;
        // `monthCount` counts the group's FULL family list, so a month header
        // does not appear only once a later page happens to cross a month.
        if (group.attention === 'settled' && group.monthCount > 1 && monthOf(f.date) !== month) {
          month = monthOf(f.date);
          header = <div className="lmonth">{formatMonth(f.date, language)}</div>;
        }
        return (
          <Fragment key={keyOf(f.items[0]!.summary)}>
            {header}
            {f.items.map((it, n) => {
              const next = f.items[n + 1];
              return (
                <LedgerRow
                  key={keyOf(it.summary)}
                  summary={it.summary}
                  depth={it.depth}
                  context={f.items.length > 1 && attentionMismatch(it.summary, group)}
                  isParent={!!next && next.depth > it.depth}
                  rowIndex={i++}
                  {...props}
                  s={s}
                />
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

function attentionMismatch(summary: ContestSummary, group: Pick<LedgerGroup, 'attention'>): boolean {
  return attentionOf(summary.phase) !== group.attention;
}
