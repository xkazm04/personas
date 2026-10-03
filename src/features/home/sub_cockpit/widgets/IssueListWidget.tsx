import { ExternalLink } from 'lucide-react';

import { openExternalUrl } from '@/api/system/system';
import { ListRow, Rows, Tile, type RowColumn, type Tone } from '@/features/shared/components/kit';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';

/**
 * `issue_list` — generic bulleted list of items with optional severity
 * badge and external link. Athena uses this to render Sentry issues,
 * GitHub PRs, failed executions, or any bullet-shaped attention
 * surface in a focused widget instead of a chat-bubble list.
 *
 * No backend fetching — items are populated from Athena's prior
 * connector_use result (or her memory). An item with an href is a pressable row: pressing its
 * name opens the link in the user's default browser through the app's outbound URL door
 * (`openExternalUrl`, the `open_external_url` command).
 *
 * Rendered as one kit Tile of kit rows: severity is the row's Mark on the spine, the worst
 * severity in the list is the TILE's mark on its rail, and the sublabel spreads into a declared
 * Detail column beside the title instead of stacking under it (kit grow-4; owner, 2026-10-03:
 * "no columns used and creating empty space over passing metadata from rows to spread"). The
 * column is declared only when some item actually carries a sublabel, so a bare list of titles
 * keeps the two-cell shape rather than growing an always-empty column. A long list is capped
 * (`ISSUE_CAP`) with "Show all N" expanding in place: the realistic count is 5-15 items already
 * sorted by Athena, and severity is readable from the marks at a glance.
 *
 * Config:
 *   {
 *     "items": [
 *       {
 *         "id": "abc-123",          // required, used as React key
 *         "title": "...",           // required
 *         "sublabel": "...",        // optional, smaller line below
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
  // The sublabel is a COLUMN, not a second line, so every row is one line high (row rhythm) and
  // the band between the name and the trail carries the detail instead of staying empty.
  const detailed = items.some((i) => i.sublabel);
  const columns: RowColumn[] | undefined = detailed ? [{ head: c.col_detail, width: '1.4fr' }] : undefined;
  const tones = items.map((i) => intentTone(i.severity));
  const worst = SEVERITY_RANK.find((tone) => tones.includes(tone));
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
      <Rows count={items.length} cap={ISSUE_CAP} empty={{ title: emptyLabel }} label={title} columns={columns} nameHead={detailed ? c.col_issue : undefined}>
        {items.map((item) => {
          const tone = intentTone(item.severity);
          const href = item.href;
          return (
            <ListRow
              key={item.id}
              size="line"
              name={item.title}
              cells={[item.sublabel]}
              mark={{ tone, glyph: tone === 'neutral' ? 'hollow' : 'solid', label: toneLabel(t, tone) }}
              figures={href ? <ExternalLink className="w-3.5 h-3.5 k-quiet" aria-hidden /> : undefined}
              onPress={href ? () => { openExternalUrl(href).catch(toastCatch('IssueListWidget:openHref')); } : undefined}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
