// The ledger: every contest as one dense row — entry, project, stage rail,
// outcome, updated — with a keyboard cursor and ONE expanded row, which is
// the detail layer. Loading v2: the header is permanent chrome; a calm,
// delayed ghost fills the body only while the first fetch is cold.
import type { ReactNode } from 'react';
import { ChevronRight, CornerDownRight } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import { phaseLabel, phaseTone } from '../../model/labels';
import { LEDGER_COPY as C, fill } from './copy';
import type { LedgerRow } from './model/ledgerOrder';
import { SeatSpecChips } from './SeatSpecChips';
import { StageRail, StageRailHeader } from './StageRail';

/** Cursor gutter · entry · project · rail · outcome · updated. */
export const LEDGER_GRID =
  'grid grid-cols-[1.25rem_minmax(12rem,2fr)_minmax(7rem,1fr)_minmax(9rem,11rem)_minmax(11rem,1.6fr)_6.5rem] items-center gap-x-3';

const ROW_H = 56;
const GHOST_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32'];

export interface LedgerTableProps {
  rows: LedgerRow[];
  cursor: number;
  expandedKey: string | null;
  onToggle: (index: number) => void;
  renderExpansion: (row: LedgerRow) => ReactNode;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onNew: () => void;
}

export function LedgerTable(props: LedgerTableProps) {
  const { rows, isLoading, error, onRetry, onNew } = props;
  const reveal = useRevealTracker();
  return (
    <div className="rounded-card border border-primary/12 bg-secondary/10" data-testid="ledger-table">
      <div className={`${LEDGER_GRID} border-b border-primary/12 px-3 py-2`} role="presentation">
        <span aria-hidden />
        <span className="typo-label text-foreground">{C.colEntry}</span>
        <span className="typo-label text-foreground">{C.colProject}</span>
        <div className="space-y-0.5">
          <span className="block typo-label text-foreground">{C.colStage}</span>
          <StageRailHeader />
        </div>
        <span className="typo-label text-foreground">{C.colOutcome}</span>
        <span className="typo-label text-foreground">{C.colUpdated}</span>
      </div>

      {error ? (
        <div className="p-3">
          <ErrorBanner message={error} variant="inline" onRetry={onRetry} />
        </div>
      ) : isLoading && rows.length === 0 ? (
        <LedgerGhostRows />
      ) : rows.length === 0 ? (
        <EmptyState
          title={C.noEntriesTitle}
          subtitle={C.noEntriesBody}
          action={{ label: C.newEntry, onClick: onNew }}
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-primary/8" aria-label={C.shellLabel}>
          {rows.map((row, i) => (
            <RevealItem
              key={row.key}
              as="li"
              revealId={row.key}
              order={i}
              hasEntered={reveal.hasEntered}
              markEntered={reveal.markEntered}
            >
              <LedgerRowView {...props} row={row} index={i} />
            </RevealItem>
          ))}
        </ul>
      )}
    </div>
  );
}

function LedgerRowView({
  row,
  index,
  cursor,
  expandedKey,
  onToggle,
  renderExpansion,
}: LedgerTableProps & { row: LedgerRow; index: number }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const c = row.summary;
  const isCursor = index === cursor;
  const isOpen = row.key === expandedKey;
  return (
    <div className={isOpen ? 'bg-secondary/25' : ''} data-testid={`ledger-row-${row.key}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-current={isCursor ? 'true' : undefined}
        onClick={() => onToggle(index)}
        className={`${LEDGER_GRID} w-full border-l-2 px-3 text-left focus-ring transition-colors hover:bg-secondary/30 ${
          isCursor ? 'border-l-primary bg-primary/8' : 'border-l-transparent'
        }`}
        style={{ minHeight: ROW_H }}
        data-cursor={isCursor || undefined}
      >
        <ChevronRight
          aria-hidden
          className={`h-3.5 w-3.5 text-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${row.depth * 1.25}rem` }}>
          {row.depth > 0 && <CornerDownRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-foreground" />}
          <span className="min-w-0">
            <span className="block truncate typo-title">{c.title}</span>
            <span className="block truncate typo-code text-foreground">
              {c.contestId}
              {c.round !== null && c.parentId ? ` · ${fill(C.roundOf, { n: c.round, parent: c.parentId })}` : ''}
            </span>
          </span>
        </span>
        <span className="truncate typo-caption text-foreground">{c.projectName}</span>
        <span className="min-w-0 space-y-1">
          <StageRail phase={c.phase} compact />
          <span className="block truncate typo-caption text-foreground">{phaseLabel(s, c.phase)}</span>
        </span>
        <span className="min-w-0">
          {c.winner ? (
            <span className="flex flex-col gap-0.5">
              <span className="typo-title">{c.winner}</span>
              {c.winnerSeatSpec && <SeatSpecChips spec={c.winnerSeatSpec} />}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge variant={phaseTone(c.phase)} size="sm" pill>
                {phaseLabel(s, c.phase)}
              </StatusBadge>
              <span className="typo-caption text-foreground">
                {fill(C.seatsCount, { count: c.seatCount })}
              </span>
            </span>
          )}
        </span>
        <RelativeTime timestamp={c.updatedAtMs} className="typo-caption text-foreground" />
      </button>
      {isOpen && <div className="border-t border-primary/10 px-3 pb-4 pt-3">{renderExpansion(row)}</div>}
    </div>
  );
}

/** Geometry-matched, calm, delayed (≥120 ms): a fast fetch never paints it. */
function LedgerGhostRows() {
  return (
    <div aria-hidden data-testid="ledger-ghost">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`${LEDGER_GRID} animate-fade-in border-b border-primary/[0.06] px-3`}
          style={{ height: ROW_H, animationDelay: `${120 + i * 35}ms` }}
        >
          <span />
          <span className={`h-3.5 rounded-interactive bg-primary/[0.06] ${GHOST_WIDTHS[i % 4]}`} />
          <span className="h-3 w-20 rounded-interactive bg-primary/[0.06]" />
          <span className="h-2 w-full rounded-interactive bg-primary/[0.06]" />
          <span className="h-3 w-24 rounded-interactive bg-primary/[0.06]" />
          <span className="h-3 w-14 rounded-interactive bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
