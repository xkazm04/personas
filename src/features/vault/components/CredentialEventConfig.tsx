import { useState, useEffect, useCallback } from 'react';
import { Zap, Clock, Loader2, Timer, ShieldAlert, CalendarClock } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { CredentialTemplateEvent, DbCredentialEvent } from '@/lib/types/types';

function safeParseConfig(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Universal rotation event templates available for all credential types */
const ROTATION_EVENT_TEMPLATES: CredentialTemplateEvent[] = [
  {
    id: 'cron_schedule',
    name: 'Scheduled Rotation',
    description: 'Rotate credentials on a cron schedule (e.g., daily, weekly).',
  },
  {
    id: 'expiration_threshold',
    name: 'Expiration Threshold',
    description: 'Trigger rotation when credential approaches its expiry date.',
  },
  {
    id: 'healthcheck_failure',
    name: 'Healthcheck Failure',
    description: 'Automatically rotate when the credential fails its healthcheck.',
  },
];

const EVENT_ICONS: Record<string, typeof Zap> = {
  cron_schedule: CalendarClock,
  expiration_threshold: Timer,
  healthcheck_failure: ShieldAlert,
};

interface CredentialEventConfigProps {
  credentialId: string;
  events?: CredentialTemplateEvent[];
}

export function CredentialEventConfig({ credentialId, events: eventsProp }: CredentialEventConfigProps) {
  const credentialEvents = usePersonaStore((s) => s.credentialEvents);
  const fetchCredentialEvents = usePersonaStore((s) => s.fetchCredentialEvents);
  const createCredentialEvent = usePersonaStore((s) => s.createCredentialEvent);
  const updateCredentialEvent = usePersonaStore((s) => s.updateCredentialEvent);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Merge connector-specific events with universal rotation templates, deduping by id
  const connectorEvents = eventsProp ?? [];
  const allTemplateIds = new Set(connectorEvents.map((e) => e.id));
  const eventTemplates = [
    ...connectorEvents,
    ...ROTATION_EVENT_TEMPLATES.filter((rt) => !allTemplateIds.has(rt.id)),
  ];

  // Filter events for this credential
  const myEvents = credentialEvents.filter((e) => e.credential_id === credentialId);

  const fetchEvents = useCallback(async () => {
    try {
      await fetchCredentialEvents();
    } catch (err) {
      console.error('Failed to fetch credential events:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchCredentialEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const getEventForTemplate = (eventTemplateId: string): DbCredentialEvent | undefined => {
    return myEvents.find(e => e.event_template_id === eventTemplateId);
  };

  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string) => {
    const existing = getEventForTemplate(eventTemplateId);
    setSaving(eventTemplateId);

    try {
      if (existing) {
        await updateCredentialEvent(existing.id, { enabled: !existing.enabled });
      } else {
        // Set sensible defaults per event type
        const defaultConfig = getDefaultConfig(eventTemplateId);
        await createCredentialEvent({
          credential_id: credentialId,
          event_template_id: eventTemplateId,
          name: eventTemplateName,
          config: defaultConfig,
        });
      }

      await fetchCredentialEvents();
    } catch (err) {
      console.error('Failed to toggle event:', err);
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateConfig = async (eventId: string, templateId: string, updates: Record<string, unknown>) => {
    const existing = myEvents.find(e => e.id === eventId);
    if (!existing) return;

    setSaving(templateId);

    try {
      const currentConfig = safeParseConfig(existing.config);
      const updatedConfig = { ...currentConfig, ...updates };

      await updateCredentialEvent(eventId, { config: updatedConfig });
      await fetchCredentialEvents();
    } catch (err) {
      console.error('Failed to update event config:', err);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground/80 text-sm">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading events...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-3.5 h-3.5 text-amber-400/70" />
        <span className="text-sm font-medium text-foreground/80 uppercase tracking-wider">Event Triggers</span>
      </div>

      {eventTemplates.map((et) => {
        const existing = getEventForTemplate(et.id);
        const isEnabled = existing ? existing.enabled : false;
        const isSaving = saving === et.id;
        const config = safeParseConfig(existing?.config);
        const Icon = EVENT_ICONS[et.id] || Zap;

        return (
          <div
            key={et.id}
            className={`p-3 rounded-xl border transition-all ${
              isEnabled
                ? 'bg-amber-500/5 border-amber-500/20'
                : 'bg-secondary/20 border-border/20'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-amber-400/60" />
                  <span className="text-sm font-medium text-foreground/80">{et.name}</span>
                  {isSaving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/80" />}
                </div>
                <p className="text-sm text-muted-foreground/80 mt-0.5">{et.description}</p>
              </div>

              {/* Toggle */}
              <button
                role="switch"
                aria-checked={isEnabled}
                aria-label={`${et.name} event trigger`}
                onClick={() => handleToggleEvent(et.id, et.name)}
                disabled={isSaving}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                  isEnabled ? 'bg-amber-500' : 'bg-secondary/60'
                } ${isSaving ? 'opacity-50' : ''}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    isEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
                <span className="sr-only">Toggle {et.name}</span>
              </button>
            </div>

            {/* Event-type-specific config (visible when enabled) */}
            {isEnabled && existing && (
              <div className="mt-3 pt-3 border-t border-border/10 space-y-2">
                {et.id === 'cron_schedule' && (
                  <CronScheduleConfig
                    config={config}
                    onUpdate={(updates) => handleUpdateConfig(existing.id, et.id, updates)}
                  />
                )}
                {et.id === 'expiration_threshold' && (
                  <ExpirationThresholdConfig
                    config={config}
                    onUpdate={(updates) => handleUpdateConfig(existing.id, et.id, updates)}
                  />
                )}
                {et.id === 'healthcheck_failure' && (
                  <div className="text-sm text-muted-foreground/80">
                    Rotation will trigger automatically when a previously-healthy credential begins failing its healthcheck.
                  </div>
                )}
                {/* Fallback: generic polling interval for connector-specific events */}
                {!['cron_schedule', 'expiration_threshold', 'healthcheck_failure'].includes(et.id) && (
                  <GenericPollingConfig
                    config={config}
                    onUpdate={(updates) => handleUpdateConfig(existing.id, et.id, updates)}
                  />
                )}

                {existing.last_polled_at && (
                  <div className="text-sm text-muted-foreground/60 mt-1">
                    Last evaluated: {new Date(existing.last_polled_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event-type-specific config sub-components
// ---------------------------------------------------------------------------

function CronScheduleConfig({
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

function ExpirationThresholdConfig({
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
        Credential must have an <code className="text-xs">expires_at</code> field in its metadata.
      </p>
    </div>
  );
}

function GenericPollingConfig({
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
        <select
          value={pollingInterval}
          onChange={(e) => onUpdate({ pollingIntervalSeconds: parseInt(e.target.value) })}
          className="px-2 py-1 bg-background/50 border border-border/30 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        >
          <option value={10}>10 seconds</option>
          <option value={30}>30 seconds</option>
          <option value={60}>1 minute</option>
          <option value={120}>2 minutes</option>
          <option value={300}>5 minutes</option>
          <option value={600}>10 minutes</option>
        </select>
      </div>
      <div className="text-sm text-muted-foreground/80">
        Approx. {Math.round(86400 / pollingInterval).toLocaleString()} checks/day
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultConfig(eventTemplateId: string): Record<string, unknown> | null {
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
