import { useState } from 'react';
import { Clock, Timer, ShieldAlert, CalendarClock } from 'lucide-react';
import type { CredentialTemplateEvent } from '@/lib/types/types';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation, type Translations } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

export function safeParseConfig(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return {};
  }
}

/**
 * Universal rotation event templates available for all credential types.
 * A function of `t`, not a module constant: built at import time from the `en`
 * shim it pinned the 84 KB `vault` section into the eager English core.
 */
export function rotationEventTemplates(t: Translations): CredentialTemplateEvent[] {
  const ec = t.vault.event_config;
  return [
    { id: 'cron_schedule', name: ec.scheduled_rotation, description: ec.scheduled_rotation_desc },
    { id: 'expiration_threshold', name: ec.expiration_threshold, description: ec.expiration_threshold_desc },
    { id: 'healthcheck_failure', name: ec.healthcheck_failure, description: ec.healthcheck_failure_desc },
  ];
}

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
          <code className="px-2 py-0.5 bg-background/50 border border-border/30 rounded-interactive typo-code text-foreground">
            {cronExpr}
          </code>
          <Button
            type="button"
            onClick={() => { setDraft(cronExpr); setEditing(true); }}
            variant="ghost"
            size="sm"
          >
            {t.common.edit}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <Button
                type="button"
                key={p.value}
                onClick={() => { setDraft(p.value); onUpdate({ cronExpression: p.value }); setEditing(false); }}
                variant={draft === p.value ? 'accent' : 'ghost'}
                tone={draft === p.value ? 'warning' : undefined}
                size="xs"
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="0 0 * * *"
              className="flex-1 px-2 py-1 bg-background/50 border border-border/30 rounded-card typo-code text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-warning/30"
            />
            <Button
              type="button"
              onClick={() => { onUpdate({ cronExpression: draft }); setEditing(false); }}
              disabled={!draft.trim()}
              variant="accent"
              tone="warning"
              size="xs"
            >
              {t.common.save}
            </Button>
            {cronExpr && (
              <Button
                type="button"
                onClick={() => { setDraft(cronExpr); setEditing(false); }}
                variant="ghost"
                size="xs"
              >
                {t.common.cancel}
              </Button>
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
            <Button
              type="button"
              key={d}
              onClick={() => onUpdate({ thresholdDays: d })}
              variant={thresholdDays === d ? 'accent' : 'ghost'}
              tone={thresholdDays === d ? 'warning' : undefined}
              size="xs"
            >
              {d}d
            </Button>
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
