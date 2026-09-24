// Seat win rates across decided contests, with their 95% Wilson interval
// drawn as a bar, and an honest "is the leader actually separated" badge.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';
import { formatNumeric } from '@/lib/utils/formatters';

import { MIN_RANKABLE_SAMPLE, seatWinRates, type SeatWinRate } from '../stats';

export interface SeatStatsBoardProps {
  contests: ContestSummary[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/** The interval as a bar on a 0–100 scale: numbers into SVG geometry, never
 *  a formatted percent string. */
function IntervalBar({ row }: { row: SeatWinRate }) {
  const { t, tx, language } = useTranslation();
  const pct = (n: number) => formatNumeric(n, 'ratio', { language, precision: 0 });
  const label = tx(t.plugins.contest.stats_interval_aria, { low: pct(row.low), high: pct(row.high) });
  const rate = row.entered > 0 ? row.wins / row.entered : 0;
  return (
    <div className="flex items-center gap-2 w-full" aria-label={label} role="img">
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 flex-1 min-w-[4rem]" aria-hidden>
        <rect x={0} y={3} width={100} height={2} className="fill-secondary" />
        <rect x={row.low * 100} y={1} width={Math.max(1, (row.high - row.low) * 100)} height={6} rx={1} className="fill-primary/40" />
        <rect x={rate * 100 - 0.75} y={0} width={1.5} height={8} className="fill-primary" />
      </svg>
      <span className="typo-caption text-foreground shrink-0">
        <Numeric value={row.low} unit="ratio" precision={0} />–<Numeric value={row.high} unit="ratio" precision={0} />
      </span>
    </div>
  );
}

export function SeatStatsBoard({ contests, isLoading, error, onRetry, className = '' }: SeatStatsBoardProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const board = useMemo(() => seatWinRates(contests), [contests]);
  const comparing = board.rows.length >= 2;

  const columns: TableColumn<SeatWinRate>[] = [
    {
      key: 'spec',
      label: s.col_spec,
      width: 'minmax(12rem, 2fr)',
      render: (r) => <span className="typo-code text-foreground break-all">{r.spec}</span>,
    },
    {
      key: 'entered',
      label: s.col_entered,
      width: '6rem',
      align: 'right',
      render: (r) => <Numeric value={r.entered} unit="count" align="right" />,
    },
    {
      key: 'wins',
      label: s.col_wins,
      width: '5rem',
      align: 'right',
      render: (r) => <Numeric value={r.wins} unit="count" align="right" />,
    },
    {
      key: 'interval',
      label: s.col_interval,
      width: 'minmax(10rem, 1.5fr)',
      render: (r) => <IntervalBar row={r} />,
    },
  ];

  return (
    <section className={`space-y-2 ${className}`} aria-label={s.stats_title} data-testid="contest-seat-stats">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="typo-heading flex-1">{s.stats_title}</h3>
        {comparing && (
          <Tooltip content={board.separated ? s.stats_separated_hint : s.stats_not_separated_hint}>
            <span>
              <StatusBadge variant={board.separated ? 'success' : 'neutral'} size="sm" pill>
                {board.separated ? s.stats_separated : s.stats_not_separated}
              </StatusBadge>
            </span>
          </Tooltip>
        )}
      </div>
      {board.decided > 0 && board.decided < MIN_RANKABLE_SAMPLE && (
        <p className="typo-caption text-foreground">{tx(s.stats_small_sample, { n: MIN_RANKABLE_SAMPLE })}</p>
      )}
      <UnifiedTable
        columns={columns}
        data={board.rows}
        getRowKey={(r) => r.spec}
        isLoading={isLoading}
        error={error ? resolveErrorTranslated(t, extractMessage(error)).message : null}
        onRetry={onRetry}
        emptyTitle={s.stats_empty}
        ariaLabel={s.stats_title}
        density="compact"
        // Windowed: one row per seat spec ever raced, which only grows.
        rowHeight={44}
        className="max-h-[24rem]"
      />
    </section>
  );
}
