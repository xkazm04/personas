// Every contest as a ledger: phase, project, when, the winner and the seat
// that made it, and the round it belongs to. Loading v2 through UnifiedTable
// (ghost under the header while cold; rows keep rendering on a refetch).
import { useMemo } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import { contestKeyString, focusContest, useContestFocus, type ContestKey } from '../focus';
import { useContests } from '../hooks/useContests';
import { phaseLabel, phaseTone } from '../model/labels';

export interface ContestLedgerListProps {
  /** Rows to show; omit to list every contest (the list hook). */
  contests?: ContestSummary[];
  /** Row click; defaults to focusing the contest. */
  onSelect?: (summary: ContestSummary) => void;
  className?: string;
}

/** Two-line rows (title over id). */
const LEDGER_ROW_HEIGHT = 56;

export function summaryKey(s: Pick<ContestSummary, 'projectId' | 'contestId'>): ContestKey {
  return { projectId: s.projectId, contestId: s.contestId };
}

export function ContestLedgerList({ contests: given, onSelect, className = '' }: ContestLedgerListProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const list = useContests();
  const focused = useContestFocus((st) => st.focused);
  const rows = given ?? list.contests;
  const focusedKey = focused ? contestKeyString(focused) : null;

  const columns = useMemo<TableColumn<ContestSummary>[]>(
    () => [
      {
        key: 'contest',
        label: s.col_contest,
        width: 'minmax(14rem, 2fr)',
        render: (r) => (
          <div className="min-w-0">
            <p className="typo-title truncate">{r.title}</p>
            <p className="typo-code text-foreground truncate">{r.contestId}</p>
          </div>
        ),
      },
      {
        key: 'project',
        label: s.col_project,
        width: 'minmax(8rem, 1fr)',
        render: (r) => <span className="typo-caption text-foreground truncate">{r.projectName}</span>,
      },
      {
        key: 'phase',
        label: s.col_phase,
        width: '9.5rem',
        render: (r) => (
          <StatusBadge variant={phaseTone(r.phase)} size="sm" pill>
            {phaseLabel(s, r.phase)}
          </StatusBadge>
        ),
      },
      {
        key: 'winner',
        label: s.col_winner,
        width: 'minmax(10rem, 1.5fr)',
        render: (r) =>
          r.winner ? (
            <div className="min-w-0">
              <p className="typo-title">{r.winner}</p>
              {r.winnerSeatSpec && <p className="typo-code text-foreground truncate">{r.winnerSeatSpec}</p>}
            </div>
          ) : (
            <span className="typo-caption text-foreground" aria-hidden>
              —
            </span>
          ),
      },
      {
        key: 'round',
        label: s.col_round,
        width: '8rem',
        render: (r) =>
          r.round !== null || r.parentId ? (
            <div className="min-w-0">
              {r.round !== null && <p className="typo-caption text-foreground">{tx(s.round_n, { n: r.round })}</p>}
              {r.parentId && (
                <p className="typo-code text-foreground truncate">{tx(s.refines_parent, { parent: r.parentId })}</p>
              )}
            </div>
          ) : (
            <span className="typo-caption text-foreground" aria-hidden>
              —
            </span>
          ),
      },
      {
        key: 'updated',
        label: s.col_updated,
        width: '7rem',
        render: (r) => <RelativeTime timestamp={r.updatedAtMs} className="typo-caption text-foreground" />,
      },
    ],
    [s, tx],
  );

  return (
    <UnifiedTable
      // Windowed and bounded: every contest of every project, and refine
      // rounds multiply them; the list must not grow the DOM with the ledger.
      className={`max-h-[36rem] ${className}`}
      rowHeight={LEDGER_ROW_HEIGHT}
      density="compact"
      columns={columns}
      data={rows}
      getRowKey={(r) => contestKeyString(summaryKey(r))}
      onRowClick={(r) => (onSelect ? onSelect(r) : focusContest(summaryKey(r)))}
      rowAccent={(r) => (contestKeyString(summaryKey(r)) === focusedKey ? 'border-l-primary' : undefined)}
      isLoading={given ? false : list.isLoading}
      error={!given && list.error ? tx(s.load_failed, { message: resolveErrorTranslated(t, extractMessage(list.error)).message }) : null}
      onRetry={given ? undefined : () => void list.refresh()}
      emptyTitle={s.ledger_empty_title}
      emptyDescription={s.ledger_empty_desc}
      ariaLabel={s.ledger_title}
    />
  );
}
