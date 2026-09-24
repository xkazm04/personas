// The stewards' (judges') scoreboard, shown in the photo finish only when
// judges ran. Mean, spread, broken flag and the per-dimension scores.
// Extractable: renders any ContestScoreboard.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { ContestScoreboard } from '@/lib/bindings/ContestScoreboard';
import type { ContestScoreRow } from '@/lib/bindings/ContestScoreRow';

import { ARENA } from './copy';

export interface StewardsScoreboardProps {
  scoreboard: ContestScoreboard;
  current: string | null;
  onSelect: (key: string) => void;
}

export function StewardsScoreboard({ scoreboard, current, onSelect }: StewardsScoreboardProps) {
  const dims = useMemo(() => [...new Set(scoreboard.rows.flatMap((r) => Object.keys(r.dims)))].sort(), [scoreboard]);
  const columns = useMemo<TableColumn<ContestScoreRow>[]>(
    () => [
      { key: 'key', label: ARENA.scoreVariant, width: '5rem', render: (r) => <span className="typo-label text-primary">{r.key}</span> },
      { key: 'mean', label: ARENA.scoreMean, width: '5rem', align: 'right', render: (r) => <Numeric value={r.mean} precision={2} align="right" /> },
      { key: 'spread', label: ARENA.scoreSpread, width: '5rem', align: 'right', render: (r) => <Numeric value={r.spread} precision={2} align="right" /> },
      ...dims.map<TableColumn<ContestScoreRow>>((d) => ({
        key: `dim-${d}`,
        label: d,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.dims[d] ?? null} precision={1} align="right" />,
      })),
      {
        key: 'broken',
        label: ARENA.scoreBroken,
        width: '6rem',
        render: (r) =>
          r.broken ? (
            <StatusBadge variant="error" size="sm" pill>
              {ARENA.scoreBroken}
            </StatusBadge>
          ) : null,
      },
    ],
    [dims],
  );

  return (
    <section className="space-y-1.5" aria-label={ARENA.scoreboard} data-testid="arena-scoreboard">
      <p className="typo-label text-foreground">{ARENA.scoreboard}</p>
      {scoreboard.judges.length > 0 && <p className="typo-caption font-mono text-foreground break-all">{scoreboard.judges.join(' · ')}</p>}
      <UnifiedTable
        columns={columns}
        data={scoreboard.rows}
        getRowKey={(r) => r.key}
        onRowClick={(r) => onSelect(r.key)}
        rowAccent={(r) => (r.key === current ? 'border-l-primary' : undefined)}
        density="compact"
        rowHeight={36}
        className="max-h-[16rem]"
        ariaLabel={ARENA.scoreboard}
      />
    </section>
  );
}
