// The judges' scoreboard, when judges ran: one row per frame, mean and
// spread across judges, the broken flag, and every scored dimension. A row
// click puts that frame on the loupe.
// Extractable: a scoreboard table for any ContestScoreboard.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { ContestScoreRow } from '@/lib/bindings/ContestScoreRow';
import type { ContestScoreboard } from '@/lib/bindings/ContestScoreboard';

import { CONTACT_COPY as C } from './copy';

export interface ScoreSheetProps {
  scoreboard: ContestScoreboard;
  current: string | null;
  onPick: (key: string) => void;
}

export function ScoreSheet({ scoreboard, current, onPick }: ScoreSheetProps) {
  const dims = useMemo(() => {
    const names = new Set<string>();
    for (const r of scoreboard.rows) for (const d of Object.keys(r.dims)) names.add(d);
    return [...names].sort();
  }, [scoreboard.rows]);

  const columns = useMemo<TableColumn<ContestScoreRow>[]>(
    () => [
      { key: 'key', label: '', width: '4.5rem', render: (r) => <span className="typo-title">{r.key}</span> },
      {
        key: 'mean',
        label: C.scoresMean,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.mean} precision={2} align="right" />,
      },
      {
        key: 'spread',
        label: C.scoresSpread,
        width: '5rem',
        align: 'right',
        render: (r) => <Numeric value={r.spread} precision={2} align="right" />,
      },
      {
        key: 'broken',
        label: C.scoresBroken,
        width: '5rem',
        render: (r) => (r.broken ? <span className="typo-caption text-status-error">✕</span> : null),
      },
      ...dims.map<TableColumn<ContestScoreRow>>((d) => ({
        key: `dim-${d}`,
        label: d,
        width: 'minmax(4rem, 1fr)',
        align: 'right',
        render: (r) => <Numeric value={r.dims[d] ?? null} precision={1} align="right" />,
      })),
    ],
    [dims],
  );

  return (
    <UnifiedTable
      columns={columns}
      data={scoreboard.rows}
      getRowKey={(r) => r.key}
      onRowClick={(r) => onPick(r.key)}
      rowAccent={(r) => (r.key === current ? 'border-l-primary' : undefined)}
      ariaLabel={C.scoresTitle}
      density="compact"
      // Windowed and bounded: one row per frame of the roll.
      rowHeight={40}
      className="max-h-[20rem]"
    />
  );
}
