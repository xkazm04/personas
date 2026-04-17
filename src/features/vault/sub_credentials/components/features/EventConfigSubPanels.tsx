import { useState } from 'react';
import { Clock, Timer, ShieldAlert, CalendarClock } from 'lucide-react';
import type { CredentialTemplateEvent } from '@/lib/types/types';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';

export function safeParseConfig(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return {};
  }
}

/** Universal rotation event templates available for all credential types */
export const ROTATION_EVENT_TEMPLATES: CredentialTemplateEvent[] = [
  { id: 'cron_schedule', name: en.vault.event_config.scheduled_rotation, description: en.vault.event_config.scheduled_rotation_desc },
  { id: 'expiration_threshold', name: en.vault.event_config.expiration_threshold, description: en.vault.event_config.expiration_threshold_desc },
  { id: 'healthcheck_failure', name: en.vault.event_config.healthcheck_failure, description: en.vault.event_config.healthcheck_failure_desc },
];

export const EVENT_ICONS: Record<string, typeof Clock> = {
  cron_schedule: CalendarClock,
  expiration_threshold: Timer,
  healthcheck_failure: ShieldAlert,
};

export function CronScheduleConfig({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const cronExpr = (config.cronExpression as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cronExpr);

  const presets = [
    { label: t.vault.event_config.cron_daily, value: '0 0 * * *' },
    { label: t.vault.event_config.cron_weekly, value: '0 0 * * 1' },
    { label: t.vault.event_config.cron_monthly, value: '0 0 1 * *' },
    { label: t.vault.event_config.cron_6h, value: '0 */6 * * *' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-3.5 h-3.5 text-foreground" />
        <label className="typo-body text-foreground">{t.vault.event_config.cron_schedule}</label>
      </div>

      {!editing && cronExpr ? (
        <div className="flex items-center gap-2">
          <code className="px-2 py-0.5 bg-background/50 border border-border/30 rounded typo-code font-mono text-foreground">
            {cronExpr}
          </code>
          <button
            onClick={() => { setDraft(cronExpr); setEditing(true); }}
            className="typo-body text-amber-400/80 hover:text-amber-400 transition-colors"
          >
            {t.common.edit}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.value}
                onClick={() => { setDraft(p.value); onUpdate({ cronExpression: p.value }); setEditing(false); }}
                className={`px-2 py-0.5 rounded-card typo-body transition-colors ${
                  draft === p.value
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    : 'bg-secondary/40 text-foreground border border-transparent hover:bg-secondary/60'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="0 0 * * *"
              className="flex-1 px-2 py-1 bg-background/50 border border-border/30 rounded-card typo-code font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/30"
            />
            <button
              onClick={() => { onUpdate({ cronExpression: draft }); setEditing(false); }}
              disabled={!draft.trim()}
              className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-400 rounded-card typo-body font-medium transition-colors disabled:opacity-50"
            >
              {t.common.save}
            </button>
            {cronExpr && (
              <button
                onClick={() => { setDraft(cronExpr); setEditing(false); }}
                className="px-2 py-1 text-foreground hover:text-foreground/90 typo-body transition-colors"
              >
                {t.common.cancel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExpirationThresholdConfig({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const thresholdDays = Number(config.thresholdDays) || 7;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Timer className="w-3.5 h-3.5 text-foreground" />
        <label className="typo-body text-foreground">{t.vault.event_config.rotate_when_expiring}</label>
        <div className="flex items-center gap-1">
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => onUpdate({ thresholdDays: d })}
              className={`px-2 py-0.5 rounded-card typo-code font-mono transition-colors ${
                thresholdDays === d
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                  : 'bg-secondary/40 text-foreground border border-transparent hover:bg-secondary/60'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <p className="typo-body text-foreground">
        {t.vault.event_config.expiration_hint}
      </p>
    </div>
  );
}

export function GenericPollingConfig({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const pollingInterval = Number(config.pollingIntervalSeconds) || 60;

  return (
    <>
      <div className="flex items-center gap-3">
        <Clock className="w-3.5 h-3.5 text-foreground" />
        <label className="typo-body text-foreground">{t.vault.event_config.polling_interval}</label>
        <ThemedSelect
          value={String(pollingInterval)}
          onChange={(e) => onUpdate({ pollingIntervalSeconds: parseInt(e.target.value) })}
          className="px-2 py-1 w-auto"
          wrapperClassName="inline-block"
        >
          <option value={10}>{t.vault.event_config.seconds_10}</option>
          <option value={30}>{t.vault.event_config.seconds_30}</option>
          <option value={60}>{t.vault.event_config.minute_1}</option>
          <option value={120}>{t.vault.event_config.minutes_2}</option>
          <option value={300}>{t.vault.event_config.minutes_5}</option>
          <option value={600}>{t.vault.event_config.minutes_10}</option>
        </ThemedSelect>
      </div>
      <div className="typo-body text-foreground">
        {t.vault.event_config.checks_per_day.replace('{count}', Math.round(86400 / pollingInterval).toLocaleString())}
      </div>
    </>
  );
}

export function getDefaultConfig(eventTemplateId: string): Record<string, unknown> | null {
  switch (eventTemplateId) {
    case 'cron_schedule':
      return { cronExpression: '0 0 * * 1' }; // Weekly on Monday midnight
    case 'expiration_threshold':
      return { thresholdDays: 7 };
    case 'healthcheck_failure':
      return {};
    default:
      return null;
  }
}
