// One contest on one line: phase, title and age, a strand per seat (the track
// is the time limit), a still of every variant in its tray colour, the verdict
// in words, the reported cost. Split out of `LedgerLevel.tsx`, which keeps the
// shell and the grouping.
import { useMemo, type RefObject } from 'react';
import { GitBranch } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { phaseLabel, type ContestStrings } from '../model/labels';
import { childrenOf, keyOf, reportedCost, verdictOf, wallOf } from './ledgerModel';
import { cascadeOrder } from './ledgerPaging';
import { MicroStills, Strands } from './LedgerCells';
import { VerdictCell } from './LedgerVerdict';
import { formatDay, formatDuration, formatUsd, PhaseDot } from './parts';

/** Everything a row needs from the level around it. */
export interface LedgerRowCtx {
  contests: ContestSummary[];
  focusKey: string | null;
  onOpen: (key: string, from: HTMLElement | null) => void;
  onFocusRow: (key: string) => void;
  rowRefs: RefObject<Map<string, HTMLDivElement>>;
  nowMs: number;
  wide: boolean;
  s: ContestStrings;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
}

export interface LedgerRowProps extends LedgerRowCtx {
  summary: ContestSummary;
  depth: number;
  context: boolean;
  isParent: boolean;
  /** Index across the whole rendered window — drives the entrance ramp. */
  rowIndex: number;
}

export function LedgerRow({
  summary, depth, context, isParent, rowIndex, s, contests, focusKey, onOpen, onFocusRow, rowRefs, nowMs, wide,
  hasEntered, markEntered,
}: LedgerRowProps) {
  const { language, tx } = useTranslation();
  const L = s.ledger;
  const key = keyOf(summary);
  const multiProject = useMemo(() => new Set(contests.map((c) => c.projectId)).size > 1, [contests]);
  const cost = reportedCost(summary.ledger.seats);
  const children = childrenOf(contests, summary);
  const verdict = verdictOf(summary, children, nowMs);
  const wall = wallOf(summary.ledger.seats, nowMs);
  return (
    <RevealItem
      revealId={key}
      order={cascadeOrder(rowIndex)}
      hasEntered={hasEntered}
      markEntered={markEntered}
      ref={(el) => {
        if (el) rowRefs.current?.set(key, el as HTMLDivElement);
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
        onOpen(key, e.currentTarget as HTMLElement);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(key, e.currentTarget as HTMLElement);
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
        <VerdictCell verdict={verdict} s={s} nowMs={nowMs} />
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
    </RevealItem>
  );
}
