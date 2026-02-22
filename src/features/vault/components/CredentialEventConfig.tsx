import { useState, useEffect, useCallback } from 'react';
import { Zap, Clock, Loader2 } from 'lucide-react';
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

  const eventTemplates = eventsProp ?? [];

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

  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string, defaultConfig?: Record<string, unknown>) => {
    const existing = getEventForTemplate(eventTemplateId);
    setSaving(eventTemplateId);

    try {
      if (existing) {
        await updateCredentialEvent(existing.id, { enabled: !existing.enabled });
      } else {
        await createCredentialEvent({
          credential_id: credentialId,
          event_template_id: eventTemplateId,
          name: eventTemplateName,
          config: defaultConfig || null,
        });
      }

      await fetchCredentialEvents();
    } catch (err) {
      console.error('Failed to toggle event:', err);
    } finally {
      setSaving(null);
    }
  };

  const handleUpdatePollingInterval = async (eventId: string, intervalSeconds: number) => {
    const existing = myEvents.find(e => e.id === eventId);
    if (!existing) return;

    setSaving(existing.event_template_id);

    try {
      const currentConfig = safeParseConfig(existing.config);
      const updatedConfig = { ...currentConfig, pollingIntervalSeconds: intervalSeconds };

      await updateCredentialEvent(eventId, { config: updatedConfig });
      await fetchCredentialEvents();
    } catch (err) {
      console.error('Failed to update polling interval:', err);
    } finally {
      setSaving(null);
    }
  };

  if (eventTemplates.length === 0) {
    return (
      <div className="text-sm text-muted-foreground/80 py-3">
        No event triggers available for this service type.
      </div>
    );
  }

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
        const pollingInterval = Number(config.pollingIntervalSeconds) || 60;

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

            {/* Config (visible when enabled and event exists) */}
            {isEnabled && existing && (
              <div className="mt-3 pt-3 border-t border-border/10 space-y-2">
                <div className="flex items-center gap-3">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <label className="text-sm text-muted-foreground/90">Polling interval</label>
                  <select
                    value={pollingInterval}
                    onChange={(e) => handleUpdatePollingInterval(existing.id, parseInt(e.target.value))}
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

                {existing.last_polled_at && (
                  <div className="text-sm text-muted-foreground/90">
                    Last polled: {new Date(existing.last_polled_at).toLocaleString()}
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
