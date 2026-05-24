import { useMemo } from 'react';
import { Bell, Clock, Repeat, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface Trigger {
  label: string;
  source: string;
  condition: string;
  grain?: string;
  idempotency_note?: string;
}

/**
 * Inline chat-card Athena emits via `show_trigger_set { intent, triggers }`.
 * Each trigger answers cycle-6 doctrine's right-grain test: one trigger
 * condition produces one persona response shape. Optional grain and
 * idempotency notes surface the design rationale alongside the config.
 *
 * Sibling of `show_use_case_set` — together they decompose a persona's
 * input distribution from two angles (when-it-fires vs what-it-handles).
 */
export function TriggerSetWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';
  const triggers = useMemo<Trigger[]>(() => {
    const raw = config?.triggers;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (tr): tr is Record<string, unknown> => typeof tr === 'object' && tr !== null,
      )
      .map((tr) => ({
        label: typeof tr.label === 'string' ? tr.label : '',
        source: typeof tr.source === 'string' ? tr.source : '',
        condition: typeof tr.condition === 'string' ? tr.condition : '',
        grain: typeof tr.grain === 'string' ? tr.grain : undefined,
        idempotency_note:
          typeof tr.idempotency_note === 'string'
            ? tr.idempotency_note
            : undefined,
      }))
      .filter((tr) => tr.label.length > 0);
  }, [config]);

  if (triggers.length === 0) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground">
        {t.plugins.companion.trigger_set_empty}
      </div>
    );
  }

  return (
    <div
      className="rounded-card border border-cyan-500/30 bg-cyan-500/[0.04] p-4 space-y-3"
      data-testid="companion-trigger-set-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-cyan-300/85">
        <Zap className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.trigger_set_title}
        </span>
        {intent && (
          <span className="text-foreground truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      <ul className="space-y-2">
        {triggers.map((tr, i) => {
          const SourceIcon = sourceIconFor(tr.source);
          return (
            <li
              key={`${tr.label}-${i}`}
              className="rounded-card border border-foreground/10 bg-secondary/40 p-3 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <SourceIcon className="w-3.5 h-3.5 text-foreground shrink-0" />
                <span className="typo-body font-medium text-foreground/95 flex-1">
                  {tr.label}
                </span>
                <span className="typo-caption text-foreground shrink-0 truncate max-w-[40%]">
                  {tr.source}
                </span>
              </div>
              <div className="pl-5 space-y-1 typo-caption text-foreground">
                <div>
                  <span className="text-foreground">
                    {t.plugins.companion.trigger_set_condition}
                    {': '}
                  </span>
                  {tr.condition}
                </div>
                {tr.grain && (
                  <div>
                    <span className="text-foreground">
                      {t.plugins.companion.trigger_set_grain}
                      {': '}
                    </span>
                    {tr.grain}
                  </div>
                )}
                {tr.idempotency_note && (
                  <div>
                    <span className="text-foreground">
                      {t.plugins.companion.trigger_set_idempotency}
                      {': '}
                    </span>
                    {tr.idempotency_note}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pick an icon hint from a free-form source string. Bell for inbox-ish
 * sources (Slack/email/webhook), Clock for scheduled, Repeat for poll-
 * style; falls back to Zap to keep the row visually anchored.
 */
function sourceIconFor(source: string): typeof Bell {
  const s = source.toLowerCase();
  if (s.includes('cron') || s.includes('schedule') || s.includes('daily') || s.includes('hourly')) {
    return Clock;
  }
  if (s.includes('poll') || s.includes('interval')) {
    return Repeat;
  }
  if (
    s.includes('slack') ||
    s.includes('email') ||
    s.includes('webhook') ||
    s.includes('event')
  ) {
    return Bell;
  }
  return Zap;
}
