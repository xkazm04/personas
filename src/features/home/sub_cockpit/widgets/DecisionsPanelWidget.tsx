import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { Tile } from '@/features/shared/components/kit';
import { useUnifiedInboxSnapshot } from '@/features/companions/athena/inbox/hooks/useUnifiedInbox';
import { formatRelativeTime } from '@/features/companions/athena/inbox/utils/formatRelativeTime';
import type { UnifiedInboxItem } from '@/features/companions/athena/inbox/types';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { DecisionDrawer } from './DecisionDrawer';
import { inboxMark } from './decisionMarks';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/** Rows shown before "Show all": the grid's list cap (home-2 contract). */
const CAP = 8;

/**
 * Decisions panel: the unified inbox (approvals, messages, health, outputs) as one kit Tile
 * holding ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`). Rows arrive ranked
 * by the inbox, so the first eight are the ones to act on; the rest expand in place with Show all
 * (the page scrolls, never the list). Pressing a row opens the DecisionDrawer with the full body
 * and the per-kind actions.
 *
 * The kind, the persona and the age are named COLUMNS, not a meta line stacked under the title: a
 * row says what it is and whose it is at the same reading height as every other row, and the
 * band a 1920 tile used to leave empty carries them.
 *
 * Config:
 *   { "limit": N }
 */
export function DecisionsPanelWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 20;
  const { t, tx } = useTranslation();
  const inbox = useUnifiedInboxSnapshot();
  const [open, setOpen] = useState<UnifiedInboxItem | null>(null);

  const rows = useMemo(() => inbox.items.slice(0, limit), [inbox.items, limit]);
  const heading = title ?? t.overview.cockpit.decisions_title;
  const count = rows.length < inbox.total
    ? tx(t.overview.cockpit.decisions_count, { shown: rows.length, total: inbox.total })
    : rows.length;

  const c = t.overview.cockpit;
  const columns = useMemo<TableColumn<UnifiedInboxItem>[]>(() => [
    {
      key: 'title',
      label: c.col_decision,
      width: 'minmax(0, 1.4fr)',
      render: (item) => nameCell(item.title, inboxMark(item, t).label, item.title),
    },
    {
      key: 'kind',
      label: c.col_kind,
      width: 'minmax(0, 9rem)',
      render: (item) => {
        const mark = inboxMark(item, t);
        return <Cell value={mark.label} tone={mark.tone} />;
      },
    },
    {
      key: 'persona',
      label: c.col_persona,
      width: 'minmax(0, 11rem)',
      render: (item) => <Cell value={item.personaName} hint={item.personaName} />,
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
      <WidgetTable<UnifiedInboxItem>
        columns={columns}
        rows={rows}
        getRowKey={(item) => item.id}
        rowTone={(item) => inboxMark(item, t).tone}
        onRowClick={setOpen}
        emptyTitle={debtText('auto_nothing_waiting_c5cb3e55')}
        label={heading}
        cap={CAP}
        testId="cockpit-decisions-panel-table"
      />
      {open && <DecisionDrawer item={open} onClose={() => setOpen(null)} />}
    </Tile>
  );
}
