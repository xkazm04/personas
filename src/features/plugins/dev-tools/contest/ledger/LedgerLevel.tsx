// Level 1, the ledger: every contest on one line, grouped by what it asks of
// the owner. A row reads a whole contest without a click: its phase, title and
// age, one strand per seat (the track is the time limit), a still of every
// variant in its tray colour, the verdict in words, and the reported cost.
import { Fragment, useMemo, type RefObject } from 'react';
import { AlertTriangle, Clock, FileText, GitBranch, ListOrdered, Medal, Trophy, X, XCircle, Activity, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';
import { formatCount } from '@/lib/utils/formatters';

import { formatUntil } from '../model/contestModel';
import { bucketLabel, phaseLabel, type ContestStrings } from '../model/labels';
import { seatWinRates } from '../stats';
import {
  attentionOf,
  ceilingS,
  childrenOf,
  keyOf,
  ledgerCounts,
  microGroups,
  microSize,
  monthOf,
  nextStart,
  reportedCost,
  runningSeats,
  seasonSpend,
  seatElapsedS,
  shortTitle,
  strandFraction,
  strandKind,
  variantName,
  verdictOf,
  wallOf,
  type LedgerFilter,
  type LedgerGroup,
  type Verdict,
} from './ledgerModel';
import { plainStateLabel, stationLabel, type LedgerStrings } from './ledgerLabels';
import {
  bucketColor,
  cssVars,
  formatDay,
  formatDuration,
  formatMonth,
  formatUsd,
  PhaseDot,
  Rich,
  Seat,
  seatColor,
  SeatText,
  Still,
} from './parts';

export interface LedgerLevelProps {
  contests: ContestSummary[];
  groups: LedgerGroup[];
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
}

export function LedgerLevel(props: LedgerLevelProps) {
  const { contests, groups, isLoading, error, onRetry, filter, query, onFilter, onClear, nowMs } = props;
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
            {groups.map((g) => (
              <GroupRows key={g.attention} group={g} {...props} s={s} />
            ))}
            <SeasonFoot contests={contests} onStandings={props.onStandings} L={L} />
          </>
        )}
      </div>
    </>
  );
}

const GROUP_TONE = { yours: 'var(--status-warning)', live: 'var(--status-processing)', settled: 'var(--status-neutral)' } as const;

function GroupRows({ group, s, ...props }: LedgerLevelProps & { group: LedgerGroup; s: ContestStrings }) {
  const { language, tx } = useTranslation();
  const L = s.ledger;
  const label = group.attention === 'yours' ? L.group_yours : group.attention === 'live' ? L.group_live : L.group_settled;
  const months = new Set(group.families.map((f) => monthOf(f.date)));
  let month: string | null = null;
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
        if (group.attention === 'settled' && months.size > 1 && monthOf(f.date) !== month) {
          month = monthOf(f.date);
          header = <div className="lmonth">{formatMonth(f.date, language)}</div>;
        }
        return (
          <Fragment key={keyOf(f.items[0]!.summary)}>
            {header}
            {f.items.map((it, i) => {
              const next = f.items[i + 1];
              return (
                <LedgerRow
                  key={keyOf(it.summary)}
                  summary={it.summary}
                  depth={it.depth}
                  context={f.items.length > 1 && attentionMismatch(it.summary, group)}
                  isParent={!!next && next.depth > it.depth}
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

function attentionMismatch(summary: ContestSummary, group: LedgerGroup): boolean {
  return attentionOf(summary.phase) !== group.attention;
}

interface RowProps extends LedgerLevelProps {
  summary: ContestSummary;
  depth: number;
  context: boolean;
  isParent: boolean;
  s: ContestStrings;
}

function LedgerRow({ summary, depth, context, isParent, s, contests, focusKey, onOpen, onFocusRow, rowRefs, nowMs, wide }: RowProps) {
  const { language, tx } = useTranslation();
  const L = s.ledger;
  const key = keyOf(summary);
  const multiProject = useMemo(() => new Set(contests.map((c) => c.projectId)).size > 1, [contests]);
  const cost = reportedCost(summary.ledger.seats);
  const children = childrenOf(contests, summary);
  const verdict = verdictOf(summary, children, nowMs);
  const wall = wallOf(summary.ledger.seats, nowMs);
  return (
    <div
      ref={(el) => {
        if (el) rowRefs.current?.set(key, el);
        else rowRefs.current?.delete(key);
      }}
      className={`lr${depth ? ' child' : ''}${context ? ' ctx' : ''}${isParent ? ' parent' : ''}${focusKey === key ? ' focus' : ''}`}
      role="row"
      tabIndex={focusKey === key ? 0 : -1}
      aria-selected={focusKey === key}
      data-key={key}
      data-testid={`ledger-row-${summary.contestId}`}
      onClick={(e) => {
        onFocusRow(key);
        onOpen(key, e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(key, e.currentTarget);
        }
      }}
    >
      <div className="c-phase" role="gridcell">
        <PhaseDot phase={summary.phase} />
        <span>{phaseLabel(s, summary.phase)}</span>
      </div>
      <div className="c-title" role="gridcell">
        <Tooltip content={summary.title} placement="top">
          <div className="t1">{summary.title}</div>
        </Tooltip>
        <div className="t2">
          {depth > 0 && (
            <span className="rpill">
              <GitBranch className="w-3 h-3" aria-hidden />
              {tx(L.round_n, { n: summary.round ?? depth + 1 })}
            </span>
          )}
          {multiProject && (
            <>
              <span className="proj">{summary.projectName}</span>
              <span className="sep">·</span>
            </>
          )}
          {formatDay(summary.date, language)}
          <span className="sep">·</span>
          <RelativeTime timestamp={summary.updatedAtMs} showTooltip={false} />
          <span className="sep">·</span>
          {tx(L.limit_min, { count: summary.ledger.timeoutMin })}
        </div>
      </div>
      <Strands summary={summary} nowMs={nowMs} s={s} />
      <MicroStills summary={summary} wide={wide} s={s} />
      <div className="c-verdict" role="gridcell">
        <VerdictCell verdict={verdict} summary={summary} s={s} nowMs={nowMs} />
      </div>
      {wide && (
        <div className="c-wall" role="gridcell">
          <div>{wall.longestS === null ? '—' : tx(L.wall_longest, { time: formatDuration(wall.longestS, false) })}</div>
          <div className="w2">
            {wall.longestS === null ? L.wall_not_started : wall.turns ? tx(L.wall_turns, { count: wall.turns }) : L.wall_no_turns}
          </div>
        </div>
      )}
      <div className="c-cost" role="gridcell">
        {cost === null ? <span className="mu">—</span> : formatUsd(cost)}
      </div>
    </div>
  );
}

function Strands({ summary, nowMs, s }: { summary: ContestSummary; nowMs: number; s: ContestStrings }) {
  const seats = summary.ledger.seats;
  const ceiling = ceilingS(summary.ledger);
  const gap = seats.length <= 2 ? 10 : seats.length === 3 ? 7 : 4;
  return (
    <div className="c-run" role="gridcell" style={cssVars({ '--strand-gap': `${gap}px` })}>
      {seats.map((seat) => {
        const kind = strandKind(seat.state);
        const frac = strandFraction(seat, ceiling, nowMs);
        return (
          <Tooltip key={seat.seatId} content={<SeatTip seat={seat} ceiling={ceiling} nowMs={nowMs} s={s} />} placement="top">
            <div className={`strand ${kind}`} style={cssVars({ '--t': seatColor(seat.state) })} data-testid={`ledger-strand-${seat.seatId}`}>
              <i className="edot" style={{ background: engineOf(seat.spec) }} aria-hidden />
              <div className="track">
                {kind === 'queued' ? (
                  <i className="tick" />
                ) : (
                  <div className="fill" style={{ width: `${(frac * 100).toFixed(2)}%` }} />
                )}
                {kind === 'out' && (
                  <span className="xend" style={{ left: `${(frac * 100).toFixed(2)}%` }}>
                    <X className="w-[11px] h-[11px]" aria-hidden />
                  </span>
                )}
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function engineOf(spec: string): string {
  const engine = spec.split(':', 1)[0];
  return engine === 'claude' ? 'var(--brand-purple)' : engine === 'codex' ? 'var(--brand-cyan)' : engine === 'grok' ? 'var(--foreground)' : 'var(--muted)';
}

function SeatTip({ seat, ceiling, nowMs, s }: { seat: ContestSeat; ceiling: number | null; nowMs: number; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const ran = seat.state !== 'queued' && seat.state !== 'idle';
  return (
    <div className="contest-ledger space-y-1" data-type-density="compact">
      <Seat spec={seat.spec} />
      <div className="flex justify-between gap-4">
        <span>{L.tip_state}</span>
        <b style={{ color: seatColor(seat.state) }}>{plainStateLabel(L, seat.state)}</b>
      </div>
      <div className="flex justify-between gap-4">
        <span>{L.tip_elapsed}</span>
        <b>{tx(L.tip_elapsed_value, { elapsed: formatDuration(seatElapsedS(seat, nowMs)), limit: formatDuration(ceiling, false) })}</b>
      </div>
      <div className="flex justify-between gap-4">
        <span>{L.tip_cost}</span>
        <b>{seat.costUsd !== null && ran ? formatUsd(seat.costUsd) : L.tip_not_reported}</b>
      </div>
      {seat.errors[0] && <div className="text-status-error">{seat.errors[0]}</div>}
    </div>
  );
}

function MicroStills({ summary, wide, s }: { summary: ContestSummary; wide: boolean; s: ContestStrings }) {
  const { tx } = useTranslation();
  const L = s.ledger;
  const groups = microGroups(summary);
  const size = microSize(groups, wide ? 380 : 234, wide ? 58 : 40);
  return (
    <div className="c-vars" role="gridcell" style={cssVars({ '--mw': `${size.w}px`, '--mh': `${size.h}px` })}>
      {groups.map((g) => (
        <span key={g.seat.seatId} className="mg">
          {g.cells.map((c, i) =>
            c.kind === 'still' ? (
              <Tooltip
                key={c.variant.key}
                content={tx(L.tip_variant, { key: c.variant.key, name: variantName(c.variant), tray: c.bucket ? bucketLabel(s, c.bucket) : s.bucket_none })}
                placement="top"
              >
                <span className={`ms${c.bucket === 'winner' ? ' win' : ''}`} data-testid={`ledger-still-${c.variant.key}`}>
                  <Still src={c.variant.still} label="" />
                  {c.bucket && <i className="bb" style={cssVars({ '--b': bucketColor(c.bucket) })} />}
                </span>
              </Tooltip>
            ) : (
              <Tooltip
                key={`empty-${i}`}
                content={c.out ? tx(L.tip_out, { state: plainStateLabel(L, g.seat.state) }) : L.tip_not_delivered}
                placement="top"
              >
                <span className={`ms empty${c.out ? ' out' : ''}`} />
              </Tooltip>
            ),
          )}
        </span>
      ))}
    </div>
  );
}

function VerdictCell({ verdict, summary, s, nowMs }: { verdict: Verdict; summary: ContestSummary; s: ContestStrings; nowMs: number }) {
  const { tx, language } = useTranslation();
  const L = s.ledger;
  const v1 = (tone: string | null, icon: React.ReactNode, body: React.ReactNode) => (
    <div className="v1" style={tone ? cssVars({ '--t': tone }) : undefined}>
      {icon}
      <span className="min-w-0 truncate">{body}</span>
    </div>
  );
  switch (verdict.kind) {
    case 'decided':
      return (
        <>
          {v1('var(--status-success)', <Trophy className="ic w-3.5 h-3.5" aria-hidden />, (
            <>
              <span className="k">{verdict.key}</span> {verdict.name}
            </>
          ))}
          <div className="v2">{verdict.spec ? <Seat spec={verdict.spec} quiet /> : L.verdict_winner_recorded}</div>
        </>
      );
    case 'shortlisted':
      return (
        <>
          {v1('var(--status-info)', <Medal className="ic w-3.5 h-3.5" aria-hidden />, <Rich template={L.verdict_shortlist} values={{ keys: <span className="k">{verdict.keys.join(', ')}</span> }} />)}
          <div className="v2">
            {verdict.child ? tx(L.verdict_round, { n: verdict.child.round ?? 2, phase: phaseLabel(s, verdict.child.phase) }) : L.verdict_no_round}
          </div>
        </>
      );
    case 'review-empty':
      return (
        <>
          {v1('var(--status-warning)', <AlertTriangle className="ic w-3.5 h-3.5" aria-hidden />, L.verdict_no_variants)}
          <div className="v2">{L.verdict_nothing_to_sort}</div>
        </>
      );
    case 'review':
      return (
        <>
          <div className="v1">
            <span>
              <Rich template={L.verdict_sorted} values={{ sorted: <span className="k">{verdict.sorted}</span>, total: verdict.total }} />
            </span>
            <span className="segbar" aria-hidden>
              {verdict.buckets.map((b, i) => (
                <i key={i} style={b ? { background: bucketColor(b) } : undefined} />
              ))}
            </span>
          </div>
          <div className="v2">
            {verdict.lead
              ? tx(L.verdict_judges_lean, { key: verdict.lead.key, mean: formatCount(verdict.lead.mean, { precision: 1 }) })
              : verdict.ownWinner
                ? tx(L.verdict_winner_pending, { key: verdict.ownWinner })
                : L.verdict_no_winner}
          </div>
        </>
      );
    case 'failed':
      return (
        <>
          {v1('var(--status-error)', <XCircle className="ic w-3.5 h-3.5" aria-hidden />, verdict.station ? tx(L.verdict_stopped_at, { station: stationLabel(L, verdict.station) }) : L.verdict_stopped)}
          <div className="v2">
            {tx(L.verdict_delivered, { delivered: verdict.delivered, seats: verdict.seats })}
            {verdict.child && ` · ${tx(L.round_n, { n: verdict.child.round ?? 2 })}`}
          </div>
        </>
      );
    case 'queued':
      return (
        <>
          {v1('var(--status-info)', <Clock className="ic w-3.5 h-3.5" aria-hidden />, verdict.startMs ? tx(L.verdict_starts, { when: formatUntil(verdict.startMs, nowMs, language) }) : L.verdict_waiting)}
          <div className="v2">{verdict.startMs ? new Date(verdict.startMs).toLocaleString(language, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : L.verdict_waiting}</div>
        </>
      );
    case 'live': {
      const template =
        verdict.phase === 'collecting' ? L.verdict_collecting : verdict.phase === 'judging' ? L.verdict_judging : verdict.phase === 'queued' ? L.verdict_queued : L.verdict_building;
      return (
        <>
          {v1('var(--status-processing)', <Activity className="ic w-3.5 h-3.5" aria-hidden />, (
            <Rich template={template} values={{ delivered: <span className="k">{verdict.delivered}</span>, expected: verdict.expected }} />
          ))}
          <div className="v2">
            {tx(L.verdict_live_seats, { count: verdict.building })}
            {verdict.waiting > 0 && ` · ${tx(L.verdict_live_waiting, { count: verdict.waiting })}`}
          </div>
        </>
      );
    }
    case 'draft':
      return (
        <>
          {v1(null, <FileText className="ic w-3.5 h-3.5" aria-hidden />, L.verdict_draft)}
          <div className="v2">{L.verdict_draft_hint}</div>
        </>
      );
  }
  void summary;
}

function LiveLine({ contests, nowMs, L }: { contests: ContestSummary[]; nowMs: number; L: LedgerStrings }) {
  const { tx, language } = useTranslation();
  const running = runningSeats(contests);
  if (!running.length) {
    const next = nextStart(contests, nowMs);
    if (next) {
      return (
        <>
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            <Rich template={L.live_next} values={{ title: <b>{shortTitle(next.summary.title)}</b>, when: formatUntil(next.ms, nowMs, language) }} />
          </span>
        </>
      );
    }
    return <span>{L.live_nothing}</span>;
  }
  const first = running[0]!;
  return (
    <>
      <i className="pulse" aria-hidden />
      <span className="min-w-0 truncate">
        <Rich
          template={L.live_building}
          values={{
            seat: (
              <b>
                <SeatText spec={first.seat.spec} />
              </b>
            ),
            elapsed: <b className="tab">{formatDuration(seatElapsedS(first.seat, nowMs))}</b>,
            title: shortTitle(first.summary.title),
          }}
        />
        {running.length > 1 && ` · ${tx(L.live_more, { count: running.length - 1 })}`}
      </span>
    </>
  );
}

function SeasonFoot({ contests, onStandings, L }: { contests: ContestSummary[]; onStandings: () => void; L: LedgerStrings }) {
  const { tx } = useTranslation();
  const s = useTranslation().t.plugins.contest;
  const board = useMemo(() => seatWinRates(contests), [contests]);
  const lead = board.rows[0];
  return (
    <div className="lfoot">
      <span>
        <Rich template={L.season_spend} values={{ amount: <b className="tab">{formatUsd(seasonSpend(contests))}</b> }} />
      </span>
      {lead && (
        <span className="inline-flex items-center gap-1.5">
          <Rich
            template={L.most_wins}
            values={{ seat: <Seat spec={lead.spec} quiet />, record: <b className="tab">{tx(L.record, { wins: lead.wins, entered: lead.entered })}</b> }}
          />
        </span>
      )}
      {lead && <span>{board.separated ? s.stats_separated : s.stats_not_separated}</span>}
      <Button variant="ghost" size="sm" className="cl-btn cl-sm" icon={<ListOrdered className="w-3.5 h-3.5" />} onClick={onStandings} data-testid="ledger-open-standings">
        {L.open_standings}
      </Button>
    </div>
  );
}

/** Cold load: rows' geometry under the column header, invisible for 120 ms. */
function LedgerGhost() {
  return (
    <div aria-hidden data-testid="ledger-ghost">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="lghost animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

