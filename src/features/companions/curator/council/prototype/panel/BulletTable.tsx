// PROTOTYPE ROUND (spark council-readout), direction C - Bullet-chart table.
//
// The queue as a real data table docked on the right of the stage: one row
// per council, the title large and never truncated, its overall as a BULLET
// CHART (the bar against the threshold tick, the measured share as the
// background band, the unmeasured rest hatched), the members as dots on the
// ramp, and the must-address count. The heads sort by project, measured
// share, overall and must-address; a third press restores the queue order.
import { useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { DataTable, KitHost, sortRows, type TableSort } from '@/features/shared/components/kit';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import type { PanelVariantProps } from '../PanelHost';
import type { PanelRow, QueueFilter } from '../protoModel';
import { PROTO } from '../protoStrings';
import { useBoxWidth } from './table/useBoxWidth';
import { useRowKeys } from './table/useRowKeys';
import { useTableColumns, type ColKey } from './table/tableColumns';
import { cycleSort, memberColumns } from './table/tableModel';
import { TableKey } from './table/TableKey';
import './table/bulletTable.css';

const S = {
  label: 'Council queue',
  filterLabel: 'Which councils',
  emptyTitle: { waiting: 'Nothing waits on you', machine: 'No machine passes', decided: 'Nothing decided yet' } satisfies Record<QueueFilter, string>,
  emptySub: 'Councils land here as their rounds finish.',
};

/** At or above this panel width the project and round get their own column. */
const WIDE_AT = 820;
const FILTERS: QueueFilter[] = ['waiting', 'machine', 'decided'];

export function BulletTable({ rows, filter, counts, onFilter, selectedId, onSelect, onOpen, rootRef, loading }: PanelVariantProps) {
  const { language } = useTranslation();
  const [sort, setSort] = useState<TableSort<ColKey> | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The filter tabs own the scroller as their panel (one panel, re-filled per tab).
  const tabs = `bt-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const wide = useBoxWidth(rootRef) >= WIDE_AT;
  const members = useMemo(() => memberColumns(rows), [rows]);
  const { cols, tableRows } = useTableColumns({ rows, members, wide, selectedId });
  // The order on screen, which is the order the arrows walk.
  const shown = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.subject.id, r]));
    return sortRows(tableRows, sort, language).flatMap((t): PanelRow[] => {
      const row = byId.get(t.id);
      return row ? [row] : [];
    });
  }, [rows, tableRows, sort, language]);
  const keys = useRowKeys({ rows: shown, selectedId, onSelect, onOpen, scrollerRef });
  const threshold = rows[0]?.rubric.threshold ?? 0.7;
  const uncalibrated = rows.some((r) => r.subject.trustState !== 'trusted');
  const empty = !loading && rows.length === 0;

  return (
    <section ref={rootRef} className={`bt${wide ? ' is-wide' : ''}${empty ? ' is-empty' : ''}`} aria-label={S.label} data-proto-panel="BulletTable">
      <header className="bt-head">
        <SegmentedTabs
          ariaLabel={S.filterLabel}
          idPrefix={tabs}
          fullWidth={false}
          activeTab={filter}
          onTabChange={onFilter}
          tabs={FILTERS.map((f) => ({
            id: f,
            label: (
              <>
                {PROTO.filter[f]}
                <b className="bt-count typo-heading font-data">{counts[f]}</b>
              </>
            ),
          }))}
        />
      </header>
      <div
        ref={scrollerRef}
        role="tabpanel"
        id={`${tabs}-panel-${filter}`}
        aria-labelledby={`${tabs}-tab-${filter}`}
        className="bt-scroll"
        onKeyDown={keys.onKeyDown}
        onDoubleClick={keys.onDoubleClick}
      >
        {empty ? (
          <ScenarioEmptyState icon={CheckCircle2} title={S.emptyTitle[filter]} subtitle={S.emptySub} />
        ) : (
          <KitHost>
            <DataTable
              cols={cols}
              rows={tableRows}
              label={S.label}
              loading={loading}
              empty={{ title: S.emptyTitle[filter] }}
              locale={language}
              sort={sort}
              onSortChange={(next) =>
                setSort((cur) => cycleSort(cur, next, cols.find((c) => c.key === next.key)?.sortable))
              }
              onRowClick={(id) => {
                const row = rows.find((r) => r.subject.id === id);
                if (row) onSelect(row.subject);
              }}
            />
          </KitHost>
        )}
      </div>
      {!empty && <TableKey threshold={threshold} uncalibrated={uncalibrated} />}
    </section>
  );
}

export default BulletTable;
