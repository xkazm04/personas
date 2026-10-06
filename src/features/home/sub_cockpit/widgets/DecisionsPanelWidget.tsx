import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { Tile } from '@/features/shared/components/kit';
import { formatRelativeTime } from './formatRelativeTime';
import type { DecisionItem } from '@/features/decision-center/model/decisionModel';
import { useDecisionRoster } from '@/features/decision-center/useDecisionRoster';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { DecisionDrawer, decisionMark } from './DecisionDrawer';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/** Rows shown before "Show all": the grid's list cap (home-2 contract). */
const CAP = 8;

/**
 * Decisions panel: the Decision Center roster — every chip, in the roster's order — as one kit
 * Tile holding ONE `UnifiedTable` (see `widgetTable.tsx`). It used to read Athena's unified inbox,
 * a second aggregation over a different set of sources with its own newest-first order, so the
 * Home tile and the title-bar badge could name different numbers for "what is waiting". Now the
 * count is the roster's total and the rows are the roster's items: the first eight are the ones to
 * act on; the rest expand in place with Show all (the page scrolls, never the list). Pressing a row
 * opens the DecisionDrawer, whose verdicts write through the same roster.
 *
 * The kind (as its chip), the source and the age are named COLUMNS, not a meta line stacked under
 * the title: a row says what it is and whose it is at the same reading height as every other row.
 *
 * Config:
 *   { "limit": N }
 */
export function DecisionsPanelWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 20;
  const { t, tx } = useTranslation();
  const roster = useDecisionRoster({ load: 'all' });
  const [open, setOpen] = useState<DecisionItem | null>(null);

  const rows = useMemo(() => roster.items.slice(0, limit), [roster.items, limit]);
  const heading = title ?? t.overview.cockpit.decisions_title;
  const count = rows.length < roster.total
    ? tx(t.overview.cockpit.decisions_count, { shown: rows.length, total: roster.total })
    : rows.length;
  const failed = Object.keys(roster.errors).length > 0;

  const c = t.overview.cockpit;
  const columns = useMemo<TableColumn<DecisionItem>[]>(() => [
    {
      key: 'title',
      label: c.col_decision,
      width: 'minmax(0, 1.4fr)',
      render: (item) => nameCell(item.title, decisionMark(item, t).label, item.title),
    },
    {
      key: 'kind',
      label: c.col_kind,
      width: 'minmax(0, 9rem)',
      render: (item) => {
        const mark = decisionMark(item, t);
        return <Cell value={mark.label} tone={mark.tone} />;
      },
    },
    {
      key: 'persona',
      label: c.col_persona,
      width: 'minmax(0, 11rem)',
      render: (item) => <Cell value={item.source.label} hint={item.source.label} />,
    },
    {
      key: 'created',
      // 'When' already exists in this section and in all 14 locales.
      label: t.overview.ipc_panel.when_header,
      width: 'minmax(0, 7rem)',
      align: 'right' as const,
      render: (item) => <Cell value={formatRelativeTime(item.createdAt, t)} data />,
    },
  ], [c.col_decision, c.col_kind, c.col_persona, t]);

  return (
    <Tile span={span} title={heading} count={rows.length ? count : undefined} actions={actions} footer={footer} testId="cockpit-widget-decisions_panel">
      <WidgetTable<DecisionItem>
        columns={columns}
        rows={rows}
        getRowKey={(item) => item.id}
        rowTone={(item) => decisionMark(item, t).tone}
        onRowClick={setOpen}
        // A source that did not answer is not "nothing waiting".
        emptyTitle={failed ? t.monitor.dc_consumers_load_failed : debtText('auto_nothing_waiting_c5cb3e55')}
        isLoading={roster.loading && rows.length === 0}
        label={heading}
        cap={CAP}
        testId="cockpit-decisions-panel-table"
      />
      {open && <DecisionDrawer item={open} decide={roster.decide} onClose={() => setOpen(null)} />}
    </Tile>
  );
}
