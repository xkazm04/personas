import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';

import { openExternalUrl } from '@/api/system/system';
import { Tile, type Tone } from '@/features/shared/components/kit';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/**
 * `issue_list` — generic bulleted list of items with optional severity
 * badge and external link. Athena uses this to render Sentry issues,
 * GitHub PRs, failed executions, or any bullet-shaped attention
 * surface in a focused widget instead of a chat-bubble list.
 *
 * No backend fetching — items are populated from Athena's prior
 * connector_use result (or her memory). An item with an href is a pressable row: pressing it
 * opens the link in the user's default browser through the app's outbound URL door
 * (`openExternalUrl`, the `open_external_url` command).
 *
 * One kit Tile holding ONE `UnifiedTable` — the app's shared table (owner, 2026-10-03:
 * "reuse components to render table we should share across the app", `EventLogList` as the
 * pattern; see `widgetTable.tsx`). Severity is the row's left accent, the worst severity in the
 * list is the TILE's mark on its rail, and the sublabel is the "Why" column: the reason this item
 * is on a triage list, which is what the default cockpit actually puts there. The column it used
 * to sit in was headed "Detail", and the owner removed that head by name. The column is declared
 * only when some item carries a sublabel, so a bare list of titles keeps one column rather than
 * growing an always-empty one. A long list is capped (`ISSUE_CAP`) with "Show all N" expanding in
 * place: the realistic count is 5-15 items already sorted by Athena, and severity is readable
 * from the accents at a glance.
 *
 * Config:
 *   {
 *     "items": [
 *       {
 *         "id": "abc-123",          // required, used as React key
 *         "title": "...",           // required
 *         "sublabel": "...",        // optional, the reason it is listed
 *         "severity": "warn",       // optional: "info"|"good"|"warn"|"bad"
 *         "href": "https://..."     // optional, the row opens it
 *       }
 *     ],
 *     "empty_label": "Nothing to show"   // optional fallback
 *   }
 */
interface IssueItem {
  id: string;
  title: string;
  sublabel?: string;
  severity?: 'info' | 'good' | 'warn' | 'bad';
  href?: string;
}

const ISSUE_CAP = 6;

/** Worst first: the tile's rail says the loudest thing its rows say. */
const SEVERITY_RANK: Tone[] = ['error', 'warning', 'info', 'success', 'neutral'];

export function IssueListWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const items = Array.isArray(config?.items) ? (config.items as IssueItem[]) : [];
  const emptyLabel = (config?.empty_label as string | undefined) ?? t.overview.cockpit.widget_empty;
  const c = t.overview.cockpit;
  const detailed = items.some((i) => i.sublabel);
  const columns = useMemo<TableColumn<IssueItem>[]>(() => {
    const cols: TableColumn<IssueItem>[] = [
      {
        key: 'title',
        label: c.col_issue,
        width: detailed ? 'minmax(0, 1.4fr)' : 'minmax(0, 1fr)',
        render: (item) => (
          <span className="flex items-center gap-1.5 min-w-0">
            {nameCell(item.title, toneLabel(t, intentTone(item.severity)), item.title)}
            {item.href && <ExternalLink className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden />}
          </span>
        ),
      },
    ];
    if (detailed) {
      cols.push({
        key: 'why',
        label: c.col_why,
        width: 'minmax(0, 1fr)',
        render: (item) => <Cell value={item.sublabel} hint={item.sublabel} />,
      });
    }
    return cols;
  }, [c.col_issue, c.col_why, detailed, t]);

  const tones = items.map((i) => intentTone(i.severity));
  const worst = SEVERITY_RANK.find((tone) => tones.includes(tone));
  const heading = typeof title === 'string' && title ? title : c.col_issue;
  // Only a list that actually holds a link presses: a pointer cursor on a row that opens nothing
  // is a lie the row cannot keep.
  const linkable = items.some((i) => i.href);
  return (
    <Tile
      span={span}
      title={title}
      count={title && items.length > 0 ? items.length : undefined}
      mark={worst && worst !== 'neutral' ? { tone: worst, glyph: 'solid', label: toneLabel(t, worst) } : undefined}
      actions={actions}
      footer={footer}
      testId="cockpit-issue-list"
    >
      <WidgetTable<IssueItem>
        columns={columns}
        rows={items}
        getRowKey={(item) => item.id}
        rowTone={(item) => intentTone(item.severity)}
        emptyTitle={emptyLabel}
        label={heading}
        cap={ISSUE_CAP}
        onRowClick={linkable ? (item) => {
          if (item.href) openExternalUrl(item.href).catch(toastCatch('IssueListWidget:openHref'));
        } : undefined}
        testId="cockpit-issue-list-table"
      />
    </Tile>
  );
}
