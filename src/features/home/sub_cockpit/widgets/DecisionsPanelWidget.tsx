import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { ListRow, Rows, Tile, type RowColumn } from '@/features/shared/components/kit';
import { useUnifiedInboxSnapshot } from '@/features/companions/athena/inbox/hooks/useUnifiedInbox';
import { formatRelativeTime } from '@/features/companions/athena/inbox/utils/formatRelativeTime';
import type { UnifiedInboxItem } from '@/features/companions/athena/inbox/types';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { DecisionDrawer } from './DecisionDrawer';
import { inboxMark } from './decisionMarks';

/** Rows shown before "Show all": the grid's list cap (home-2 contract). */
const CAP = 8;

/**
 * Decisions panel: the unified inbox (approvals, messages, health, outputs) as one kit Tile.
 * Rows arrive ranked by the inbox, so the first eight are the ones to act on; the rest expand in
 * place with Show all (the page scrolls, never the list). Pressing a row opens the
 * DecisionDrawer with the full body and the per-kind actions.
 *
 * The kind and the persona are declared COLUMNS the rows fill (kit grow-4), not a meta line
 * stacked under the title: a row says what it is and whose it is at the same reading height as
 * every other row, and the band a 1920 tile used to leave empty carries them.
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
  // The persona drops first on a narrow tile: the title already names the thing to decide.
  const columns: RowColumn[] = [
    { head: c.col_kind, width: '8rem' },
    { head: c.col_persona, width: '11rem', collapse: true },
  ];
  return (
    <Tile span={span} title={heading} count={rows.length ? count : undefined} actions={actions} footer={footer} testId="cockpit-widget-decisions_panel">
      <Rows count={rows.length} cap={CAP} label={heading} empty={{ title: debtText('auto_nothing_waiting_c5cb3e55') }} columns={columns} nameHead={c.col_decision}>
        {rows.map((item) => {
          const mark = inboxMark(item, t);
          return (
            <ListRow
              key={item.id}
              size="line"
              name={item.title}
              mark={mark}
              cells={[mark.label, item.personaName]}
              time={formatRelativeTime(item.createdAt, t)}
              onPress={() => setOpen(item)}
            />
          );
        })}
      </Rows>
      {open && <DecisionDrawer item={open} onClose={() => setOpen(null)} />}
    </Tile>
  );
}
