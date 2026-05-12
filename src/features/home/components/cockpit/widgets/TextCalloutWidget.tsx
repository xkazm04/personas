import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `text_callout` — narrative panel with markdown body and an intent
 * accent (info / good / warn / bad). Athena uses this to *lead* a
 * cockpit with a one-paragraph summary before the user scans the
 * metric cards or issue lists below: "Here's what I see going on this
 * week: traffic to the OAuth callback is up 40%, and three Sentry
 * issues land on the new persona endpoint."
 *
 * Config:
 *   {
 *     "body": "Markdown text. Supports **bold**, lists, etc.",
 *     "intent": "info"   // "info" | "good" | "warn" | "bad"
 *   }
 */
export function TextCalloutWidget({ config, title }: CockpitWidgetProps) {
  const body = (config?.body as string | undefined) ?? '';
  const intent = (config?.intent as string | undefined) ?? 'info';

  const accent = INTENT_STYLES[intent] ?? INTENT_STYLES.info!;
  const Icon = accent.icon;

  return (
    <div
      className={`rounded-card border ${accent.border} ${accent.bg} p-4 h-full flex flex-col min-h-0 gap-2`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${accent.iconColor} shrink-0`} />
        {title ? (
          <div className="typo-caption text-foreground/70 uppercase tracking-wide">
            {title}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto typo-body text-foreground/85">
        {body ? (
          <MarkdownRenderer content={body} />
        ) : (
          <span className="text-foreground/40">No content.</span>
        )}
      </div>
    </div>
  );
}

const INTENT_STYLES: Record<
  string,
  {
    border: string;
    bg: string;
    icon: typeof Info;
    iconColor: string;
  }
> = {
  info: {
    border: 'border-foreground/10',
    bg: 'bg-foreground/[0.02]',
    icon: Info,
    iconColor: 'text-foreground/60',
  },
  good: {
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/5',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
  },
  warn: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
  },
  bad: {
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/5',
    icon: XCircle,
    iconColor: 'text-rose-400',
  },
};
