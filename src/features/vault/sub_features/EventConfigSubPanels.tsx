import { useState } from 'react';
import { Clock, Timer, ShieldAlert, CalendarClock } from 'lucide-react';
import type { CredentialTemplateEvent } from '@/lib/types/types';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';

export function safeParseConfig(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Universal rotation event templates available for all credential types */
export const ROTATION_EVENT_TEMPLATES: CredentialTemplateEvent[] = [
  { id: 'cron_schedule', name: 'Scheduled Rotation', description: 'Rotate credentials on a cron schedule (e.g., daily, weekly).' },
  { id: 'expiration_threshold', name: 'Expiration Threshold', description: 'Trigger rotation when credential approaches its expiry date.' },
  { id: 'healthcheck_failure', name: 'Healthcheck Failure', description: 'Automatically rotate when the credential fails its healthcheck.' },
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
  const cronExpr = (config.cronExpression as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cronExpr);

  const presets = [
    { label: 'Daily (midnight)', value: '0 0 * * *' },
    { label: 'Weekly (Mon)', value: '0 0 * * 1' },
    { label: 'Monthly (1st)', value: '0 0 1 * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-3.5 h-3.5 text-muted-foreground/80" />
        <label className="text-sm text-muted-foreground/90">Cron schedule</label>
      </div>

      {!editing && cronExpr ? (
        <div className="flex items-center gap-2">
          <code className="px-2 py-0.5 bg-background/50 border border-border/30 rounded text-sm font-mono text-foreground/80">
            {cronExpr}
          </code>
          <button
            onClick={() => { setDraft(cronExpr); setEditing(true); }}
            className="text-sm text-amber-400/80 hover:text-amber-400 transition-colors"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.value}
                onClick={() => { setDraft(p.value); onUpdate({ cronExpression: p.value }); setEditing(false); }}
                className={`px-2 py-0.5 rounded-md text-sm transition-colors ${
                  draft === p.value
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60'
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
              className="flex-1 px-2 py-1 bg-background/50 border border-border/30 rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
            <button
              onClick={() => { onUpdate({ cronExpression: draft }); setEditing(false); }}
              disabled={!draft.trim()}
              className="px-2 py-1 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-400 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              Save
            </button>
            {cronExpr && (
              <button
                onClick={() => { setDraft(cronExpr); setEditing(false); }}
                className="px-2 py-1 text-muted-foreground/80 hover:text-foreground/90 text-sm transition-colors"
              >
                Cancel
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
  const thresholdDays = Number(config.thresholdDays) || 7;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Timer className="w-3.5 h-3.5 text-muted-foreground/80" />
        <label className="text-sm text-muted-foreground/90">Rotate when expiring within</label>
        <div className="flex items-center gap-1">
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => onUpdate({ thresholdDays: d })}
              className={`px-2 py-0.5 rounded-md text-sm font-mono transition-colors ${
                thresholdDays === d
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                  : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground/60">
        Credential must have an <code className="text-sm">expires_at</code> field in its metadata.
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
  const pollingInterval = Number(config.pollingIntervalSeconds) || 60;

  return (
    <>
      <div className="flex items-center gap-3">
        <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
        <label className="text-sm text-muted-foreground/90">Polling interval</label>
        <ThemedSelect
          value={pollingInterval}
          onChange={(e) => onUpdate({ pollingIntervalSeconds: parseInt(e.target.value) })}
          className="px-2 py-1 w-auto"
          wrapperClassName="inline-block"
        >
          <option value={10}>10 seconds</option>
          <option value={30}>30 seconds</option>
          <option value={60}>1 minute</option>
          <option value={120}>2 minutes</option>
          <option value={300}>5 minutes</option>
          <option value={600}>10 minutes</option>
        </ThemedSelect>
      </div>
      <div className="text-sm text-muted-foreground/80">
        Approx. {Math.round(86400 / pollingInterval).toLocaleString()} checks/day
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
