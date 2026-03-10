<<<<<<< HEAD
import { useState, useEffect, useCallback, useRef } from 'react';
=======
import { useState, useEffect, useCallback } from 'react';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { Zap, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { CredentialTemplateEvent, DbCredentialEvent } from '@/lib/types/types';
import {
  safeParseConfig,
  ROTATION_EVENT_TEMPLATES,
  EVENT_ICONS,
  CronScheduleConfig,
  ExpirationThresholdConfig,
  GenericPollingConfig,
  getDefaultConfig,
} from '@/features/vault/sub_features/EventConfigSubPanels';

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

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const getEventForTemplate = (eventTemplateId: string): DbCredentialEvent | undefined => {
    return myEvents.find(e => e.event_template_id === eventTemplateId);
  };

<<<<<<< HEAD
  const toggleInFlightRef = useRef<Set<string>>(new Set());

  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string) => {
    if (toggleInFlightRef.current.has(eventTemplateId)) return;
    toggleInFlightRef.current.add(eventTemplateId);
=======
  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string) => {
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
      toggleInFlightRef.current.delete(eventTemplateId);
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
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 text-amber-400/70 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 text-amber-400/60" />
                  )}
                  <span className="text-sm font-medium text-foreground/80">{et.name}</span>
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
