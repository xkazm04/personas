/**
 * VARIANT 3 - LEDGER. THESIS: nothing is encoded in position. One dense row per
 * goal, grouped by project, with the milestone as its own COLUMN you can read,
 * sort and drop onto.
 *
 * The owner's standing note on this app is that components fly empty without
 * structure, that striped rows read badly, and that metadata spread across a
 * row with no columns is wasted space. This is the answer to that: every fact a
 * goal carries - title, status, cut, due, progress - is a column with a header,
 * through `display/UnifiedTable` (one table system, persisted column widths,
 * its own loading and empty contract), and the milestone cell is both the drop
 * target and the right-click door.
 *
 * What it trades: the shape of time. A filmstrip shows you forty goals and
 * their timing in one glance; a table shows you forty rows and makes you read.
 * This variant is for working the backlog, not for sensing it.
 */
import { useCallback, useMemo } from 'react';

import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { CanvasFrame } from '../shared/canvasParts';
import { useProgressView } from '../shared/canvasHost';
import { LedgerLaneCell } from './LedgerLaneCell';
import { LedgerStatusCell } from './LedgerStatusCell';
import { ledgerFillColor, ledgerFillPct, ledgerRail } from './ledgerSignals';
import type { MilestoneLane } from '../shared/milestoneOps';
import type { ProgressNode } from '../shared/useProgressModel';

export interface LedgerRow {
  node: ProgressNode;
  projectId: string;
  projectName: string;
  lane: MilestoneLane | null;
}

const ROW_HEIGHT = 40;

export function LedgerCanvas() {
  const { t, language } = useTranslation();
  const { model, canvas, dl, openGoal } = useProgressView();

  const rows = useMemo<LedgerRow[]>(
    () =>
      model.rows.flatMap((row) => {
        const lanes = canvas.lanesByProject?.get(row.projectId) ?? [];
        return row.nodes.map((node) => ({
          node,
          projectId: row.projectId,
          projectName: row.name,
          lane: lanes.find((l) => l.goalIds.has(node.goal.id)) ?? null,
        }));
      }),
    [model.rows, canvas.lanesByProject],
  );

  const percent = useMemo(() => new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }), [language]);
  const checklist = model.checklistByGoal;
  const pctOf = useCallback(
    (r: LedgerRow) => ledgerFillPct(checklist.get(r.node.goal.id), r.node.goal.progress),
    [checklist],
  );

  const columns = useMemo<TableColumn<LedgerRow>[]>(
    () => [
      {
        key: 'goal',
        label: t.monitor.triage_kind_goal,
        width: 'minmax(0, 2.4fr)',
        sortable: true,
        sortFn: (a, b) => a.node.goal.title.localeCompare(b.node.goal.title),
        render: (r) => (
          <div className="flex items-center gap-2 min-w-0">
            {/* The square is the drag HANDLE as well as the status glyph, so the
                ledger gains the same gesture the boards have without a second
                drag contract. */}
            <CanvasFrame
              node={r.node}
              projectId={r.projectId}
              dl={dl}
              bound={r.lane !== null}
              lane={r.lane ?? null}
            />
            <Tooltip content={r.node.goal.title}>
              <span className="typo-label text-foreground truncate">{r.node.goal.title}</span>
            </Tooltip>
          </div>
        ),
      },
      {
        key: 'status',
        label: t.common.status,
        width: 'minmax(0, 1.7fr)',
        sortable: true,
        sortFn: (a, b) => a.node.goal.status.localeCompare(b.node.goal.status),
        render: (r) => (
          <LedgerStatusCell goalId={r.node.goal.id} status={r.node.goal.status} onSettled={model.refresh} onOpen={() => openGoal(r.node.goal.id)} />
        ),
      },
      {
        key: 'milestone',
        label: t.ship.the_cut,
        width: 'minmax(0, 1.5fr)',
        sortable: true,
        sortFn: (a, b) => (a.lane?.name ?? '').localeCompare(b.lane?.name ?? ''),
        render: (r) => <LedgerLaneCell row={r} />,
      },
      {
        key: 'due',
        label: t.deployment.dashboard.col_target,
        width: '7rem',
        align: 'right',
        sortable: true,
        sortFn: (a, b) =>
          (Date.parse(a.node.goal.target_date ?? '') || 0) - (Date.parse(b.node.goal.target_date ?? '') || 0),
        render: (r) => (
          <RelativeTime
            timestamp={r.node.goal.target_date}
            fallback={dl.progress_no_date}
            className={`typo-caption tabular-nums ${r.node.overdue ? 'text-status-error' : 'text-foreground'}`}
          />
        ),
      },
      {
        key: 'progress',
        label: t.monitor.triage_fact_progress,
        width: '5rem',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => pctOf(a) - pctOf(b),
        render: (r) => (
          <span className="typo-caption text-foreground tabular-nums">{percent.format(pctOf(r) / 100)}</span>
        ),
      },
    ],
    [dl, t, pctOf, percent, model.refresh],
  );

  return (
    <UnifiedTable<LedgerRow>
      columns={columns}
      data={rows}
      getRowKey={(r) => r.node.goal.id}
      onRowClick={(r) => openGoal(r.node.goal.id)}
      rowHeight={ROW_HEIGHT}
      tableId="goals-progress-ledger"
      borderless
      ariaLabel={dl.goal_view_progress}
      emptyTitle={dl.progress_empty_title}
      emptyArt="chart"
      groupBy={(r) => ({ key: r.projectId, label: r.projectName })}
      rowAccent={(r) => ledgerRail(r.node.goal.status, r.node.overdue)}
      rowFill={(r) => ({ pct: pctOf(r), color: ledgerFillColor(checklist.get(r.node.goal.id)) })}
      rowReveal={{ resetKey: model.doneFilter }}
    />
  );
}
