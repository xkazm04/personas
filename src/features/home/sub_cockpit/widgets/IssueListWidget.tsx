import { ExternalLink } from 'lucide-react';

import { ListRow, Rows, Tile } from '@/features/shared/components/kit';
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
 * name opens the link in the user's default browser via `window.open`.
 *
 * Rendered as one kit Tile of kit rows: severity is the row's Mark on the spine, the name spans
 * the tile's width, and a long list is capped (`ISSUE_CAP`) with "Show all N" expanding in
 * place. Cap + Show all rather than a grouped parent layer: the realistic count is 5-15 items
 * already sorted by Athena, and severity is readable from the marks at a glance.
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

export function IssueListWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const items = Array.isArray(config?.items) ? (config.items as IssueItem[]) : [];
  const emptyLabel = (config?.empty_label as string | undefined) ?? t.overview.cockpit.widget_empty;
  // One row height for the whole list (row rhythm): two lines when any item has a sublabel.
  const size = items.some((i) => i.sublabel) ? 's' : 'line';
  return (
    <Tile span={span} title={title} count={title && items.length > 0 ? items.length : undefined} actions={actions} footer={footer} testId="cockpit-issue-list">
      <Rows count={items.length} cap={ISSUE_CAP} empty={{ title: emptyLabel }} label={title}>
        {items.map((item) => {
          const tone = intentTone(item.severity);
          const href = item.href;
          return (
            <ListRow
              key={item.id}
              size={size}
              name={item.title}
              meta={item.sublabel}
              mark={{ tone, glyph: tone === 'neutral' ? 'hollow' : 'solid', label: toneLabel(t, tone) }}
              figures={href ? <ExternalLink className="w-3.5 h-3.5 k-quiet" aria-hidden /> : undefined}
              onPress={href ? () => { window.open(href, '_blank', 'noopener'); } : undefined}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
