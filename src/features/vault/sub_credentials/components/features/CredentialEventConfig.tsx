import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('credential-event-config');
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useVaultStore } from "@/stores/vaultStore";
import type { CredentialTemplateEvent } from '@/lib/types/types';
import {
  safeParseConfig,
  ROTATION_EVENT_TEMPLATES,
  getDefaultConfig,
} from '@/features/vault/sub_credentials/components/features/EventConfigSubPanels';
import { EventTemplateCard } from './EventTemplateCard';

interface CredentialEventConfigProps {
  credentialId: string;
  events?: CredentialTemplateEvent[];
}

export function CredentialEventConfig({ credentialId, events: eventsProp }: CredentialEventConfigProps) {
  const credentialEvents = useVaultStore((s) => s.credentialEvents);
  const fetchCredentialEvents = useVaultStore((s) => s.fetchCredentialEvents);
  const createCredentialEvent = useVaultStore((s) => s.createCredentialEvent);
  const updateCredentialEvent = useVaultStore((s) => s.updateCredentialEvent);

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
      logger.error('Failed to fetch credential events', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [fetchCredentialEvents]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const getEventForTemplate = (eventTemplateId: string) => {
    return myEvents.find(e => e.event_template_id === eventTemplateId);
  };

  const toggleInFlightRef = useRef<Set<string>>(new Set());

  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string) => {
    if (toggleInFlightRef.current.has(eventTemplateId)) return;
    toggleInFlightRef.current.add(eventTemplateId);
    const existing = getEventForTemplate(eventTemplateId);
    setSaving(eventTemplateId);
    try {
      if (existing) {
        await updateCredentialEvent(existing.id, { enabled: !existing.enabled });
      } else {
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
      logger.error('Failed to toggle event', { error: String(err) });
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
      logger.error('Failed to update event config', { error: String(err) });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground/80 text-sm">
        <LoadingSpinner size="xs" />
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

      {eventTemplates.map((et) => (
        <EventTemplateCard
          key={et.id}
          template={et}
          existing={getEventForTemplate(et.id)}
          isSaving={saving === et.id}
          onToggle={handleToggleEvent}
          onUpdateConfig={handleUpdateConfig}
        />
      ))}
    </div>
  );
}
