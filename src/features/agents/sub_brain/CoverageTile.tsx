import { useMemo } from 'react';
import { ScanSearch } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CoverageCell } from '@/lib/bindings/CoverageCell';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { splitCoverage, type CoverageRow } from './brainMath';
import type { CharterRef } from './useBrainDashboard';

/**
 * Charter coverage — **the tile that exists to show what is NOT there.**
 *
 * `coverage[]` can only ever name charters that already have episodes, so the
 * absence set is the difference against the live roster. A charter with no
 * episodes renders as an explicit "nothing recorded", never as a `0` sitting
 * in a numeric column where it reads like a measurement of activity.
 */
/** One compact row, matching `density="compact"`'s own rhythm. */
const COVERAGE_ROW_HEIGHT = 36;

export function CoverageTile({
  cells,
  charters,
  chartersFailed,
  isLoading,
}: {
  cells: CoverageCell[];
  charters: CharterRef[];
  chartersFailed: boolean;
  isLoading: boolean;
}) {
  const { t, tx } = useTranslation();
  const b = t.agents.brain;
  const split = useMemo(() => splitCoverage(cells, charters), [cells, charters]);

  // Absence first — the whole point of the tile — then the covered charters,
  // then the two buckets that belong to no live charter.
  const rows: CoverageRow[] = [
    ...split.uncovered,
    ...split.covered,
    ...(split.unassigned ? [split.unassigned] : []),
    ...split.orphans,
  ];

  const columns: TableColumn<CoverageRow>[] = [
    {
      key: 'charter',
      label: b.coverage_col_charter,
      width: 'minmax(140px, 1fr)',
      render: (row) => <CoverageName row={row} />,
    },
    {
      key: 'episodes',
      label: b.coverage_col_episodes,
      width: '140px',
      align: 'right',
      render: (row) =>
        row.count != null && row.count > 0 ? (
          <Numeric className="text-foreground" value={row.count} unit="plain" align="right" />
        ) : (
          // Never a bare zero, and never a blank: an unmeasured charter
          // (`count === null`) states the absence in the same words a measured
          // empty one does, because to the operator both mean "nothing here".
          <span className="typo-caption text-foreground/85">{b.coverage_nothing}</span>
        ),
    },
  ];

  const gaps = split.uncovered.length;

  return (
    <SectionCard
      title={b.coverage_title}
      subtitle={b.coverage_subtitle}
      icon={<ScanSearch className="w-3.5 h-3.5 text-primary" aria-hidden />}
      status={gaps > 0 ? 'warning' : undefined}
    >
      <div data-testid="brain-coverage">
        <p className="typo-caption text-foreground/85 mb-2" data-testid="brain-coverage-summary">
          {chartersFailed
            ? b.coverage_roster_unavailable
            : charters.length === 0
              ? b.coverage_no_roster
              : gaps === 0
                ? b.coverage_all_covered
                : tx(b.coverage_gap_summary, { gaps, total: charters.length })}
        </p>

        {rows.length === 0 && !isLoading ? (
          <EmptyState
            icon={ScanSearch}
            title={b.coverage_none_title}
            description={chartersFailed ? b.coverage_roster_unavailable : b.coverage_none_desc}
            className="py-4"
          />
        ) : (
          <UnifiedTable
            columns={columns}
            data={rows}
            getRowKey={(row) => row.key}
            isLoading={isLoading}
            density="compact"
            borderless
            stickyHeader={false}
            // The row set is one row per live charter plus the orphan cells —
            // a number the product decides, not this component. Naming the row
            // height windows the list and caps the card at ~8 rows of scroll,
            // so a roster of 300 charters costs the same DOM as a roster of 8.
            rowHeight={COVERAGE_ROW_HEIGHT}
            className="max-h-[300px]"
            emptyTitle={b.coverage_none_title}
            emptyDescription={b.coverage_none_desc}
            ariaLabel={b.coverage_title}
            rowAccent={(row) =>
              row.count != null && row.count > 0 ? undefined : 'border-l-status-warning'
            }
          />
        )}
      </div>
    </SectionCard>
  );
}

function CoverageName({ row }: { row: CoverageRow }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  if (row.kind === 'unassigned') {
    return <span className="typo-caption text-foreground/85">{b.coverage_unassigned}</span>;
  }
  if (row.kind === 'orphan') {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="typo-caption text-foreground/85 shrink-0">{b.coverage_orphan}</span>
        <UuidLabel value={row.key} />
      </span>
    );
  }
  return <span className="typo-caption text-foreground truncate">{row.title}</span>;
}
