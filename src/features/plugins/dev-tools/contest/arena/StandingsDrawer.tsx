// Standings: the "what did I gain?" layer. Every decided race with its
// winning variant, the seat that built it and the round it came from; below,
// each seat's win rate with its Wilson interval (the shared stats board).
import { useMemo } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { BaseModal } from '@/lib/ui/BaseModal';

import { SeatStatsBoard } from '../components/SeatStatsBoard';
import { contestKeyString, type ContestKey } from '../focus';
import { SeatLabel } from './SeatLabel';

const TITLE_ID = 'arena-standings-title';

export interface StandingsDrawerProps {
  contests: ContestSummary[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (key: ContestKey) => void;
  onClose: () => void;
}

export function StandingsDrawer({ contests, isLoading, error, onRetry, onPick, onClose }: StandingsDrawerProps) {
  const { t, tx } = useTranslation();
  const a = t.plugins.contest.arena;
  const decided = useMemo(() => contests.filter((c) => c.phase === 'decided'), [contests]);
  const columns = useMemo<TableColumn<ContestSummary>[]>(
    () => [
      {
        key: 'race',
        label: a.col_race,
        width: 'minmax(10rem, 1.4fr)',
        render: (r) => (
          <div className="min-w-0">
            <p className="typo-body text-foreground line-clamp-2">{r.title}</p>
            <p className="typo-caption text-foreground truncate">{r.projectName}</p>
          </div>
        ),
      },
      { key: 'winner', label: a.col_winner, width: '5.5rem', render: (r) => <span className="typo-caption text-primary">{r.winner ?? '—'}</span> },
      {
        key: 'seat',
        label: a.col_seat,
        width: 'minmax(12rem, 1.6fr)',
        render: (r) => (r.winnerSeatSpec ? <SeatLabel spec={r.winnerSeatSpec} /> : <span className="typo-caption text-foreground">—</span>),
      },
      {
        key: 'round',
        label: a.col_round,
        width: '6rem',
        render: (r) => <span className="typo-caption text-foreground">{r.round !== null ? tx(a.round_n, { n: r.round }) : a.first_round}</span>,
      },
      {
        key: 'decided',
        label: a.col_decided,
        width: '7rem',
        render: (r) => <RelativeTime timestamp={r.updatedAtMs} className="typo-caption text-foreground" />,
      },
    ],
    [a, tx],
  );

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal maxWidthClass="max-w-3xl">
      <div className="flex h-full min-h-0 flex-col typo-body" data-testid="arena-standings">
        <header className="flex items-start gap-3 border-b border-primary/10 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={TITLE_ID} className="typo-title">
              {a.standings}
            </h2>
            <p className="typo-caption text-foreground">{a.standings_hint}</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={t.common.close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section className="space-y-2" aria-label={a.podium_history}>
            <h3 className="typo-label">{a.podium_history}</h3>
            <UnifiedTable
              columns={columns}
              data={decided}
              getRowKey={(r) => contestKeyString({ projectId: r.projectId, contestId: r.contestId })}
              onRowClick={(r) => onPick({ projectId: r.projectId, contestId: r.contestId })}
              isLoading={isLoading}
              error={error ? a.roster_load_failed : null}
              onRetry={onRetry}
              emptyTitle={a.history_empty}
              ariaLabel={a.podium_history}
              density="compact"
              rowHeight={56}
              className="max-h-[24rem]"
            />
          </section>
          <SeatStatsBoard contests={contests} isLoading={isLoading} error={error} onRetry={onRetry} />
        </div>
      </div>
    </BaseModal>
  );
}
