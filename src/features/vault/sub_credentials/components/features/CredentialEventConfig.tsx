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
import { useTranslation } from '@/i18n/useTranslation';

interface CredentialEventConfigProps {
  credentialId: string;
  events?: CredentialTemplateEvent[];
}

export function CredentialEventConfig({ credentialId, events: eventsProp }: CredentialEventConfigProps) {
  const { t } = useTranslation();
  const credentialEvents = useVaultStore((s) => s.credentialEvents);
  const fetchCredentialEvents = useVaultStore((s) => s.fetchCredentialEvents);
  const createCredentialEvent = useVaultStore((s) => s.createCredentialEvent);
  const updateCredentialEvent = useVaultStore((s) => s.updateCredentialEvent);

  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

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
  const configInFlightRef = useRef<Set<string>>(new Set());

  const markSaving = (templateId: string) =>
    setSavingIds((prev) => {
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
  const clearSaving = (templateId: string) =>
    setSavingIds((prev) => {
      if (!prev.has(templateId)) return prev;
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });

  const handleToggleEvent = async (eventTemplateId: string, eventTemplateName: string) => {
    if (toggleInFlightRef.current.has(eventTemplateId)) return;
    toggleInFlightRef.current.add(eventTemplateId);
    const existing = getEventForTemplate(eventTemplateId);
    markSaving(eventTemplateId);
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
      clearSaving(eventTemplateId);
    }
  };

  const handleUpdateConfig = async (eventId: string, templateId: string, updates: Record<string, unknown>) => {
    // Serialize concurrent config writes on the same event: a second write
    // that starts before the first resolves would otherwise merge against a
    // stale pre-update snapshot and clobber the first write's field.
    if (configInFlightRef.current.has(eventId)) return;
    configInFlightRef.current.add(eventId);
    try {
      const existing = myEvents.find(e => e.id === eventId);
      if (!existing) return;

      markSaving(templateId);
      try {
        const currentConfig = safeParseConfig(existing.config);
        const updatedConfig = { ...currentConfig, ...updates };
        await updateCredentialEvent(eventId, { config: updatedConfig });
        await fetchCredentialEvents();
      } catch (err) {
        logger.error('Failed to update event config', { error: String(err) });
      } finally {
        clearSaving(templateId);
      }
    } finally {
      configInFlightRef.current.delete(eventId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-foreground typo-body">
        <LoadingSpinner size="xs" />
        {t.vault.event_config.loading}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-3.5 h-3.5 text-amber-400/70" />
        <span className="typo-body font-medium text-foreground uppercase tracking-wider">{t.vault.event_config.event_triggers}</span>
      </div>

      {eventTemplates.map((et) => (
        <EventTemplateCard
          key={et.id}
          template={et}
          existing={getEventForTemplate(et.id)}
          isSaving={savingIds.has(et.id)}
          onToggle={handleToggleEvent}
          onUpdateConfig={handleUpdateConfig}
        />
      ))}
    </div>
  );
}
