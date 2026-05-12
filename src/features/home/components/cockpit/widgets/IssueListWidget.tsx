import { ExternalLink } from 'lucide-react';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `issue_list` — generic bulleted list of items with optional severity
 * badge and external link. Athena uses this to render Sentry issues,
 * GitHub PRs, failed executions, or any bullet-shaped attention
 * surface in a focused widget instead of a chat-bubble list.
 *
 * No backend fetching — items are populated from Athena's prior
 * connector_use result (or her memory). Click on an item's href opens
 * the link in the user's default browser via `window.open`.
 *
 * Config:
 *   {
 *     "items": [
 *       {
 *         "id": "abc-123",          // required, used as React key
 *         "title": "...",           // required
 *         "sublabel": "...",        // optional, smaller line below
 *         "severity": "warn",       // optional: "info"|"good"|"warn"|"bad"
 *         "href": "https://..."     // optional, renders ↗ icon
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

export function IssueListWidget({ config, title }: CockpitWidgetProps) {
  const items = (config?.items as IssueItem[] | undefined) ?? [];
  const emptyLabel =
    (config?.empty_label as string | undefined) ?? 'No items.';

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      {title ? (
        <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-3">
          {title}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-foreground/40 typo-caption">
          {emptyLabel}
        </div>
      ) : (
        <ul className="flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-input px-2 py-1.5 hover:bg-foreground/[0.04] transition-colors"
            >
              <SeverityDot severity={item.severity} />
              <div className="flex-1 min-w-0">
                <div className="typo-body text-foreground/90 truncate">
                  {item.title}
                </div>
                {item.sublabel ? (
                  <div className="typo-caption text-foreground/50 truncate">
                    {item.sublabel}
                  </div>
                ) : null}
              </div>
              {item.href ? (
                <button
                  type="button"
                  onClick={() => window.open(item.href, '_blank', 'noopener')}
                  className="text-foreground/40 hover:text-foreground/80 transition-colors shrink-0"
                  aria-label="Open in browser"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { severity?: IssueItem['severity'] }) {
  const color =
    severity === 'bad'
      ? 'bg-rose-400'
      : severity === 'warn'
        ? 'bg-amber-400'
        : severity === 'good'
          ? 'bg-emerald-400'
          : 'bg-foreground/30';
  return <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${color} shrink-0`} aria-hidden />;
}
