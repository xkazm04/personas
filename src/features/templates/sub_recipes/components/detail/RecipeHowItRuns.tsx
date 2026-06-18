import { Calendar, Bell, Cpu, Mail, Activity, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe } from '../../types';

interface RecipeHowItRunsProps {
  recipe: Recipe;
}

/**
 * "What it does" card: trigger cadence, notification channels (rendered as
 * branded chips instead of raw machine tokens) and preferred tools.
 * Policy rows moved to RecipeGuardrailsCard — they're explanations, not specs.
 */
export function RecipeHowItRuns({ recipe }: RecipeHowItRunsProps) {
  const { t } = useTranslation();
  const { template } = recipe;

  return (
    <section className="rounded-card border border-card-border bg-secondary/30 p-4 shadow-elevation-1">
      <h4 className="typo-label uppercase tracking-wider text-foreground mb-3">
        {t.recipes_catalog.what_it_does_heading}
      </h4>

      <SpecRow icon={Calendar} label={t.recipes_catalog.spec_trigger_label}>
        {template.suggestedTrigger?.description ?? t.recipes_catalog.trigger_manual}
        {template.suggestedTrigger?.cron && (
          <span className="ml-2 typo-label font-mono px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40 text-foreground">
            {template.suggestedTrigger.cron}
          </span>
        )}
      </SpecRow>

      <SpecRow icon={Bell} label={t.recipes_catalog.spec_notifications_label}>
        {template.notificationChannelTypes.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            {template.notificationChannelTypes.map((ch) => <ChannelChip key={ch} channel={ch} />)}
          </span>
        ) : (
          <span className="text-foreground">{t.recipes_catalog.spec_notifications_none}</span>
        )}
      </SpecRow>

      {template.toolHints.length > 0 && (
        <SpecRow icon={Cpu} label={t.recipes_catalog.spec_tools_label}>
          <span className="inline-flex items-center gap-1 flex-wrap">
            {template.toolHints.slice(0, 4).map((tool) => (
              <span
                key={tool}
                className="typo-label font-mono px-1.5 py-0.5 rounded border border-card-border/50 bg-secondary/30 text-foreground"
              >
                {tool}
              </span>
            ))}
            {template.toolHints.length > 4 && (
              <span className="typo-label font-mono text-foreground">
                +{template.toolHints.length - 4}
              </span>
            )}
          </span>
        </SpecRow>
      )}

      {(template.eventSubscriptions?.length ?? 0) > 0 && (
        <SpecRow icon={Activity} label={t.recipes_catalog.events_label}>
          <span className="inline-flex items-center gap-1 flex-wrap">
            {template.eventSubscriptions!.map((ev) => <EventChip key={`${ev.direction}:${ev.eventType}`} event={ev} />)}
          </span>
        </SpecRow>
      )}
    </section>
  );
}

interface EventChipProps {
  event: { eventType: string; direction: 'listen' | 'emit'; description?: string };
}

/** Direction-badged event chip: ↘ listen (incoming) / ↗ emit (outgoing).
 *  The event description rides in a tooltip so the row stays scannable. */
function EventChip({ event }: EventChipProps) {
  const { t } = useTranslation();
  const emit = event.direction === 'emit';
  const Icon = emit ? ArrowUpRight : ArrowDownLeft;
  const dirLabel = emit ? t.recipes_catalog.event_emit_label : t.recipes_catalog.event_listen_label;
  const chip = (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border typo-label font-mono ${
        emit
          ? 'border-primary/35 bg-primary/10 text-primary'
          : 'border-card-border/60 bg-secondary/40 text-foreground'
      }`}
      aria-label={`${dirLabel}: ${event.eventType}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {event.eventType}
    </span>
  );
  return event.description
    ? <Tooltip content={event.description}>{chip}</Tooltip>
    : chip;
}

function ChannelChip({ channel }: { channel: string }) {
  const { t } = useTranslation();
  if (channel === 'email') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/40">
        <Mail className="w-3 h-3 text-foreground" />
        <span className="typo-caption text-foreground">{t.recipes_catalog.channel_email_label}</span>
      </span>
    );
  }
  const m = getConnectorMeta(channel);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-secondary/40"
      style={{ borderColor: `${m.color}55` }}
    >
      <ConnectorIcon meta={m} size="w-3 h-3" />
      <span className="typo-caption font-medium" style={{ color: m.color }}>{m.label}</span>
    </span>
  );
}

interface SpecRowProps {
  icon: typeof Calendar;
  label: string;
  children: React.ReactNode;
}

function SpecRow({ icon: Icon, label, children }: SpecRowProps) {
  return (
    <div className="flex items-start gap-2 py-2 border-t border-card-border/40 first:border-t-0 first:pt-0">
      <Icon className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
      <span className="typo-caption text-foreground w-24 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 typo-caption text-foreground/90">{children}</span>
    </div>
  );
}
