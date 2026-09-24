// Ledger & stats: "what did I gain?". Every decided roll as a kept print —
// the kept frame, the seat that made it, the round, and that seat's record
// with its 95% Wilson interval — then the shared seat win-rate board and
// the shared ledger of every roll, one layer down.
// Extractable: `KeeperCard` (a decided contest's outcome as one card).
import { useMemo } from 'react';
import { Star } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { ContestLedgerList } from '../../components/ContestLedgerList';
import { SeatStatsBoard } from '../../components/SeatStatsBoard';
import { useContests } from '../../hooks/useContests';
import { seatWinRates, type SeatWinRate } from '../../stats';
import { CONTACT_COPY as C, fill } from './copy';
import { SpecChips } from './SpecChips';

export interface KeepersViewProps {
  onOpen: (projectId: string, contestId: string, frameKey?: string) => void;
}

export function KeeperCard({ summary, record, onOpen }: { summary: ContestSummary; record: SeatWinRate | null; onOpen: () => void }) {
  return (
    <li className="space-y-2 rounded-card border border-primary/12 bg-secondary/15 p-3" data-testid={`contact-keeper-${summary.contestId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Star className="w-4 h-4 text-status-success" aria-hidden />
        <Button variant="link" size="sm" onClick={onOpen} className="min-w-0">
          <span className="typo-title-lg truncate">{summary.title}</span>
        </Button>
        <span className="typo-heading">{summary.winner}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 typo-caption text-foreground">
        <span>{summary.projectName}</span>
        {summary.round !== null && <span>{fill(C.stripRound, { n: summary.round })}</span>}
        <RelativeTime timestamp={summary.updatedAtMs} className="typo-caption text-foreground" />
      </div>
      {summary.winnerSeatSpec && <SpecChips spec={summary.winnerSeatSpec} />}
      {record && (
        <p className="typo-caption text-foreground">
          {fill(C.keeperRecord, { wins: record.wins, entered: record.entered })} · {C.keeperInterval}{' '}
          <Numeric value={record.low} unit="ratio" precision={0} />–<Numeric value={record.high} unit="ratio" precision={0} />
        </p>
      )}
      {summary.shortlist.length > 0 && (
        <p className="typo-caption text-foreground">{fill(C.keeperShortlist, { keys: summary.shortlist.join(', ') })}</p>
      )}
    </li>
  );
}

export function KeepersView({ onOpen }: KeepersViewProps) {
  const { contests, isLoading, error, refresh } = useContests();
  const decided = useMemo(() => contests.filter((c) => c.phase === 'decided' && c.winner), [contests]);
  const bySpec = useMemo(() => new Map(seatWinRates(contests).rows.map((r) => [r.spec, r])), [contests]);

  return (
    <div className="space-y-6" data-testid="contact-keepers">
      <section className="space-y-2" aria-label={C.keepersTitle}>
        <div className="space-y-0.5">
          <h3 className="typo-heading">{C.keepersTitle}</h3>
          <p className="typo-caption text-foreground">{C.keepersHint}</p>
        </div>
        {!isLoading && decided.length === 0 ? (
          <p className="typo-body text-foreground">{C.keepersEmpty}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {decided.map((c) => (
              <KeeperCard
                key={`${c.projectId}/${c.contestId}`}
                summary={c}
                record={c.winnerSeatSpec ? (bySpec.get(c.winnerSeatSpec) ?? null) : null}
                onOpen={() => onOpen(c.projectId, c.contestId, c.winner ?? undefined)}
              />
            ))}
          </ul>
        )}
      </section>

      <SeatStatsBoard contests={contests} isLoading={isLoading} error={error} onRetry={() => void refresh()} />

      <section className="space-y-2" aria-label={C.ledgerTitle}>
        <h3 className="typo-heading">{C.ledgerTitle}</h3>
        <ContestLedgerList onSelect={(r) => onOpen(r.projectId, r.contestId)} />
      </section>
    </div>
  );
}
