import { Zap } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialTemplateEvent, CredentialEvent } from '@/lib/types/types';
import {
  safeParseConfig,
  EVENT_ICONS,
  CronScheduleConfig,
  ExpirationThresholdConfig,
  GenericPollingConfig,
} from '@/features/vault/sub_credentials/components/features/EventConfigSubPanels';
import { useTranslation } from '@/i18n/useTranslation';

interface EventTemplateCardProps {
  template: CredentialTemplateEvent;
  existing: CredentialEvent | undefined;
  isSaving: boolean;
  onToggle: (eventTemplateId: string, eventTemplateName: string) => void;
  onUpdateConfig: (eventId: string, templateId: string, updates: Record<string, unknown>) => void;
}

export function EventTemplateCard({
  template,
  existing,
  isSaving,
  onToggle,
  onUpdateConfig,
}: EventTemplateCardProps) {
  const { t, tx } = useTranslation();
  const isEnabled = existing ? existing.enabled : false;
  const config = safeParseConfig(existing?.config);
  const Icon = EVENT_ICONS[template.id] || Zap;

  return (
    <div
      className={`p-3 rounded-modal border transition-all ${
        isEnabled
          ? 'bg-status-warning/5 border-status-warning/20'
          : 'bg-surface-1 border-border/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isSaving ? (
              <LoadingSpinner size="sm" className="text-status-warning/70" />
            ) : (
              <Icon className="w-3.5 h-3.5 text-status-warning/60" />
            )}
            <span className="typo-body text-foreground">{template.name}</span>
          </div>
          <p className="typo-body text-foreground mt-0.5">{template.description}</p>
        </div>

        {/* Toggle */}
        <AccessibleToggle
          checked={isEnabled}
          onChange={() => onToggle(template.id, template.name)}
          label={tx(t.vault.event_config.template_trigger_aria, { name: template.name })}
          disabled={isSaving}
          className="flex-shrink-0"
        />
      </div>

      {/* Event-type-specific config (visible when enabled) */}
      {isEnabled && existing && (
        <div className="mt-3 pt-3 border-t border-border/10 space-y-2">
          {template.id === 'cron_schedule' && (
            <CronScheduleConfig
              config={config}
              onUpdate={(updates) => onUpdateConfig(existing.id, template.id, updates)}
            />
          )}
          {template.id === 'expiration_threshold' && (
            <ExpirationThresholdConfig
              config={config}
              onUpdate={(updates) => onUpdateConfig(existing.id, template.id, updates)}
            />
          )}
          {template.id === 'healthcheck_failure' && (
            <div className="typo-body text-foreground">
              {t.vault.event_config.healthcheck_auto_rotate}
            </div>
          )}
          {/* Fallback: generic polling interval for connector-specific events */}
          {!['cron_schedule', 'expiration_threshold', 'healthcheck_failure'].includes(template.id) && (
            <GenericPollingConfig
              config={config}
              onUpdate={(updates) => onUpdateConfig(existing.id, template.id, updates)}
            />
          )}

          {existing.last_polled_at && (
            <div className="typo-body text-foreground mt-1">
              {t.vault.event_config.last_evaluated.replace('{time}', new Date(existing.last_polled_at).toLocaleString())}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
