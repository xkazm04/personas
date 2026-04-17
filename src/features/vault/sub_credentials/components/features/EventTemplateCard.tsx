import { Zap } from 'lucide-react';
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
  const { t } = useTranslation();
  const isEnabled = existing ? existing.enabled : false;
  const config = safeParseConfig(existing?.config);
  const Icon = EVENT_ICONS[template.id] || Zap;

  return (
    <div
      className={`p-3 rounded-modal border transition-all ${
        isEnabled
          ? 'bg-amber-500/5 border-amber-500/20'
          : 'bg-secondary/20 border-border/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isSaving ? (
              <LoadingSpinner size="sm" className="text-amber-400/70" />
            ) : (
              <Icon className="w-3.5 h-3.5 text-amber-400/60" />
            )}
            <span className="text-sm font-medium text-foreground">{template.name}</span>
          </div>
          <p className="text-sm text-foreground mt-0.5">{template.description}</p>
        </div>

        {/* Toggle */}
        <button
          role="switch"
          aria-checked={isEnabled}
          aria-label={`${template.name} event trigger`}
          onClick={() => onToggle(template.id, template.name)}
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
          <span className="sr-only">Toggle {template.name}</span>
        </button>
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
            <div className="text-sm text-foreground">
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
            <div className="text-sm text-foreground mt-1">
              {t.vault.event_config.last_evaluated.replace('{time}', new Date(existing.last_polled_at).toLocaleString())}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
