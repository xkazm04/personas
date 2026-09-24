// The stewards' (judges') scoreboard, shown in the photo finish only when
// judges ran. Mean, spread, broken flag and the per-dimension scores.
// Extractable: renders any ContestScoreboard.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestScoreboard } from '@/lib/bindings/ContestScoreboard';
import type { ContestScoreRow } from '@/lib/bindings/ContestScoreRow';

import { SeatLabel } from './SeatLabel';
import { ToneDot } from './ToneDot';

export interface StewardsScoreboardProps {
  scoreboard: ContestScoreboard;
  current: string | null;
  onSelect: (key: string) => void;
  /** Judge seat id -> its spec, so a judge reads like any other seat. */
  specOf?: (seatId: string) => string;
}

export function StewardsScoreboard({ scoreboard, current, onSelect, specOf = (id) => id }: StewardsScoreboardProps) {
  const { t } = useTranslation();
  const a = t.plugins.contest.arena;
  const dims = useMemo(() => [...new Set(scoreboard.rows.flatMap((r) => Object.keys(r.dims)))].sort(), [scoreboard]);
  const columns = useMemo<TableColumn<ContestScoreRow>[]>(
    () => [
      { key: 'key', label: a.score_variant, width: '5rem', render: (r) => <span className="typo-caption text-primary">{r.key}</span> },
      { key: 'mean', label: a.score_mean, width: '5rem', align: 'right', render: (r) => <Numeric value={r.mean} precision={2} align="right" /> },
      { key: 'spread', label: a.score_spread, width: '5rem', align: 'right', render: (r) => <Numeric value={r.spread} precision={2} align="right" /> },
      ...dims.map<TableColumn<ContestScoreRow>>((d) => ({
        key: `dim-${d}`,
        label: d,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.dims[d] ?? null} precision={1} align="right" />,
      })),
      {
        key: 'broken',
        label: a.score_broken,
        width: '6rem',
        render: (r) =>
          r.broken ? <ToneDot tone="error">{a.score_broken}</ToneDot> : null,
      },
    ],
    [dims, a],
  );

  return (
    <section className="space-y-1.5" aria-label={a.scoreboard} data-testid="arena-scoreboard">
      <h3 className="typo-label">{a.scoreboard}</h3>
      {scoreboard.judges.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
          {scoreboard.judges.map((j) => (
            <SeatLabel key={j} spec={specOf(j)} />
          ))}
        </p>
      )}
      <UnifiedTable
        columns={columns}
        data={scoreboard.rows}
        getRowKey={(r) => r.key}
        onRowClick={(r) => onSelect(r.key)}
        rowAccent={(r) => (r.key === current ? 'border-l-primary' : undefined)}
        density="compact"
        rowHeight={36}
        className="max-h-[16rem]"
        ariaLabel={a.scoreboard}
      />
    </section>
  );
}
