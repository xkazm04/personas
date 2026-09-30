import { Dot, Tile } from '@/features/shared/components/kit';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone } from './intentColors';

/**
 * `text_callout` — narrative panel with markdown body and an intent
 * accent (info / good / warn / bad). Athena uses this to *lead* a
 * cockpit with a one-paragraph summary before the user scans the
 * metric cards or issue lists below: "Here's what I see going on this
 * week: traffic to the OAuth callback is up 40%, and three Sentry
 * issues land on the new persona endpoint."
 *
 * Rendered as one kit Tile whose height is the text's (no dead card under three lines): the
 * body is the shared MarkdownRenderer at card density, held to a readable measure; a non-info
 * intent is a Dot before the title (the tile keeps the kit band, not a raw-palette wash).
 *
 * Config:
 *   {
 *     "body": "Markdown text. Supports **bold**, lists, etc.",
 *     "intent": "info"   // "info" | "good" | "warn" | "bad"
 *   }
 */
export function TextCalloutWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const body = (config?.body as string | undefined) ?? '';
  const tone = intentTone(config?.intent, 'info');
  const heading = title && tone !== 'info' && tone !== 'neutral'
    ? <><Dot tone={tone} glyph="solid" /><span>{title}</span></>
    : title;
  return (
    <Tile
      span={span}
      title={heading}
      actions={actions}
      footer={footer}
      state={body ? undefined : 'empty'}
      empty={{ title: t.overview.cockpit.widget_empty }}
      testId="cockpit-text-callout"
    >
      <div className="k-in max-w-[96ch]">
        <MarkdownRenderer content={body} variant="card" />
      </div>
    </Tile>
  );
}
