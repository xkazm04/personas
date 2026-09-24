// The judges' scoreboard (judging/scoreboard.json projected), one row per
// variant: mean, spread, a broken flag, and each rubric dimension. Only
// rendered when judges ran. Extractable: it needs only the scoreboard.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { ContestScoreboard } from '@/lib/bindings/ContestScoreboard';
import type { ContestScoreRow } from '@/lib/bindings/ContestScoreRow';

import { LEDGER_COPY as C } from './copy';

export interface ScoreboardTableProps {
  scoreboard: ContestScoreboard;
  /** Highlight the variant the review is looking at. */
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}

export function ScoreboardTable({ scoreboard, activeKey = null, onSelect, className = '' }: ScoreboardTableProps) {
  const dims = useMemo(() => {
    const names = new Set<string>();
    for (const r of scoreboard.rows) for (const d of Object.keys(r.dims)) names.add(d);
    return [...names].sort();
  }, [scoreboard.rows]);

  const columns = useMemo<TableColumn<ContestScoreRow>[]>(
    () => [
      {
        key: 'key',
        label: C.reviewList,
        width: '5rem',
        render: (r) => <span className="typo-data text-foreground">{r.key}</span>,
      },
      {
        key: 'mean',
        label: C.scoreMean,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.mean} precision={2} align="right" />,
      },
      {
        key: 'spread',
        label: C.scoreSpread,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.spread} precision={2} align="right" />,
      },
      ...dims.map<TableColumn<ContestScoreRow>>((d) => ({
        key: `dim-${d}`,
        label: d,
        width: 'minmax(4.5rem, 1fr)',
        align: 'right',
        render: (r) => <Numeric value={r.dims[d] ?? null} precision={1} align="right" />,
      })),
      {
        key: 'broken',
        label: C.scoreBroken,
        width: '6rem',
        render: (r) =>
          r.broken ? (
            <StatusBadge variant="error" size="sm" pill>
              {C.scoreBroken}
            </StatusBadge>
          ) : null,
      },
    ],
    [dims],
  );

  return (
    <section aria-label={C.scoreboard} className={`space-y-1.5 ${className}`} data-testid="ledger-scoreboard">
      <h4 className="typo-label text-foreground">
        {C.scoreboard} · <span className="typo-code">{scoreboard.judges.join(', ')}</span>
      </h4>
      <UnifiedTable
        columns={columns}
        data={scoreboard.rows}
        getRowKey={(r) => r.key}
        onRowClick={onSelect ? (r) => onSelect(r.key) : undefined}
        rowAccent={(r) => (r.key === activeKey ? 'border-l-primary' : undefined)}
        density="compact"
        rowHeight={40}
        className="max-h-[18rem]"
        ariaLabel={C.scoreboard}
      />
    </section>
  );
}
