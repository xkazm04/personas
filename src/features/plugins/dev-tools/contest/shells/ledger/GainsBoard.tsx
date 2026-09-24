// "What did I gain?" — every decided contest as one line: the winner, the
// seat that made it, the round it took, and that seat's win-rate interval
// across all decided contests. Under it, the seat win-rate board.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { SeatStatsBoard } from '../../components/SeatStatsBoard';
import { seatWinRates } from '../../stats';
import { LEDGER_COPY as C, fill } from './copy';
import { ledgerGains, type LedgerGain } from './model/ledgerFacts';
import { SeatSpecChips } from './SeatSpecChips';

export interface GainsBoardProps {
  contests: ContestSummary[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (gain: LedgerGain) => void;
}

export function GainsBoard({ contests, isLoading, error, onRetry, onOpen }: GainsBoardProps) {
  const gains = useMemo(() => ledgerGains(contests, seatWinRates(contests).rows), [contests]);

  const columns = useMemo<TableColumn<LedgerGain>[]>(
    () => [
      {
        key: 'entry',
        label: C.colEntry,
        width: 'minmax(12rem, 1.6fr)',
        render: (g) => (
          <div className="min-w-0">
            <p className="truncate typo-title">{g.summary.title}</p>
            <p className="truncate typo-code text-foreground">{g.summary.projectName}</p>
          </div>
        ),
      },
      {
        key: 'winner',
        label: C.colOutcome,
        width: '5rem',
        render: (g) => <span className="typo-data text-foreground">{g.winner}</span>,
      },
      {
        key: 'seat',
        label: C.gainsSeat,
        width: 'minmax(14rem, 2fr)',
        render: (g) => (g.seatSpec ? <SeatSpecChips spec={g.seatSpec} /> : <span className="typo-caption">—</span>),
      },
      {
        key: 'round',
        label: C.gainsRound,
        width: '7rem',
        render: (g) => (
          <span className="typo-caption text-foreground">
            {g.round <= 1 ? C.gainsRoundFirst : fill(C.roundOf, { n: g.round, parent: g.summary.parentId ?? '—' })}
          </span>
        ),
      },
      {
        key: 'rate',
        label: C.gainsRate,
        width: 'minmax(9rem, 1fr)',
        render: (g) =>
          g.rate ? (
            <span className="typo-caption text-foreground">
              <Numeric value={g.rate.low} unit="ratio" precision={0} />–
              <Numeric value={g.rate.high} unit="ratio" precision={0} />{' '}
              <span className="text-foreground">
                ({fill(C.gainsRateOf, { wins: g.rate.wins, entered: g.rate.entered })})
              </span>
            </span>
          ) : (
            <span className="typo-caption">—</span>
          ),
      },
      {
        key: 'updated',
        label: C.colUpdated,
        width: '6.5rem',
        render: (g) => <RelativeTime timestamp={g.summary.updatedAtMs} className="typo-caption text-foreground" />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6" data-testid="ledger-gains">
      <section aria-label={C.gainsTitle} className="space-y-2">
        <h3 className="typo-heading">{C.gainsTitle}</h3>
        <UnifiedTable
          columns={columns}
          data={gains}
          getRowKey={(g) => g.key}
          onRowClick={onOpen}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          emptyTitle={C.gainsEmpty}
          ariaLabel={C.gainsTitle}
          density="compact"
          rowHeight={56}
          className="max-h-[28rem]"
        />
      </section>
      <SeatStatsBoard contests={contests} isLoading={isLoading} error={null} />
    </div>
  );
}
