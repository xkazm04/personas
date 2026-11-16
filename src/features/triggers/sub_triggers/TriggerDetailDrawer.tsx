import { Trash2, X, Check, Play, Terminal, FlaskConical } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaTrigger } from '@/lib/types/types';
import type { TriggerRateLimitConfig } from '@/lib/utils/platform/triggerConstants';
import { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';
import { RateLimitControls } from './RateLimitControls';
import { ActiveHoursSection } from './ActiveHoursSection';
import { UnattendedModeSection } from './UnattendedModeSection';
import { TriggerExecutionHistory } from './TriggerExecutionHistory';
import { ConfigSection } from './TriggerConfigSection';
import { DryRunResultView } from './DryRunResultView';
import { WebhookRequestInspector } from './WebhookRequestInspector';
import { CompositePartialMatchIndicator } from './CompositePartialMatchIndicator';
import { useTranslation } from '@/i18n/useTranslation';

interface TriggerDetailDrawerProps {
  trigger: PersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  onDelete: (triggerId: string) => void;
  rateLimit: TriggerRateLimitConfig;
  rateLimitState?: TriggerRateLimitState | null;
  onRateLimitChange: (updated: TriggerRateLimitConfig) => void;
  rawConfig: Record<string, unknown>;
  onActiveWindowChange: (updated: Record<string, unknown>) => void;
}

export function TriggerDetailDrawer({ trigger, credentialEventsList, onDelete, rateLimit, rateLimitState, onRateLimitChange, rawConfig, onActiveWindowChange }: TriggerDetailDrawerProps) {
  const { t } = useTranslation();
  const detail = useTriggerDetail(trigger.id, trigger.persona_id);
  return (
    <div
      className="animate-fade-slide-in overflow-hidden"
    >
      <div className="px-3 pb-3 space-y-3">
        <div className="border-t border-primary/8" />

        <ConfigSection trigger={trigger} credentialEventsList={credentialEventsList} detail={detail} />

        {trigger.trigger_type === 'composite' && (
          <CompositePartialMatchIndicator triggerId={trigger.id} />
        )}

        <RateLimitControls rateLimit={rateLimit} runtimeState={rateLimitState} onChange={onRateLimitChange} />

        <ActiveHoursSection config={rawConfig} onChange={onActiveWindowChange} />

        <UnattendedModeSection trigger={trigger} />

        {/* Test Result */}
        {detail.testResult && (
          <div
            className={`animate-fade-slide-in px-2.5 py-1.5 rounded-modal typo-code ${
              detail.testResult.success
                ? 'bg-status-success/10 text-status-success border border-status-success/15'
                : 'bg-status-error/10 text-status-error border border-status-error/15'
            }`}
          >
            {detail.testResult.success ? '\u2713' : '\u2717'} {detail.testResult.message}
          </div>
        )}

        <DryRunResultView detail={detail} />

        {/* Curl command for webhooks */}
        {trigger.trigger_type === 'webhook' && (
          <Button
            type="button"
            onClick={detail.copyCurlCommand}
            variant={detail.copiedCurl ? 'secondary' : 'ghost'}
            size="sm"
            icon={<Terminal className="w-3 h-3" />}
          >{detail.copiedCurl ? t.common.copied : t.triggers.copy_sample_curl}</Button>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-1">
          {/* Testing actions group */}
          <div className="flex items-center gap-0.5 rounded-modal bg-surface-1 p-1">
            <Button
              type="button"
              onClick={detail.handleTestFire}
              disabled={detail.testing}
              tooltip={t.triggers.validate_and_fire_title}
              variant="ghost"
              size="sm"
              icon={detail.testing ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
            >{detail.testing ? t.triggers.detail.validating : t.triggers.test_fire_label}</Button>

            <Button
              type="button"
              onClick={detail.handleDryRun}
              disabled={detail.dryRunning || detail.testing}
              tooltip={t.triggers.simulate_trigger_title}
              variant="ghost"
              size="sm"
              icon={detail.dryRunning ? <LoadingSpinner size="sm" /> : <FlaskConical className="w-4 h-4" />}
            >{detail.dryRunning ? t.triggers.detail.simulating : t.triggers.dry_run_label}</Button>
          </div>

          <div className="flex-1" />

          {/* Divider */}
          <div className="h-6 w-px bg-surface-1" />

          {/* Destructive actions group */}
          <div className="flex items-center rounded-modal bg-status-error/5 p-1">
            {detail.confirmingDelete ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => detail.confirmDelete(onDelete)} title={t.triggers.detail.delete_confirm} className="text-status-error bg-status-error/15 hover:bg-status-error/25">
                  <Check className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={detail.cancelDelete} title={t.common.cancel}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={detail.startDeleteConfirm}
                tooltip={t.triggers.detail.delete_trigger}
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
              >{t.common.delete}</Button>
            )}
          </div>
        </div>

        {trigger.trigger_type === 'webhook' && (
          <WebhookRequestInspector triggerId={trigger.id} />
        )}

        <TriggerExecutionHistory triggerId={trigger.id} personaId={trigger.persona_id} />
      </div>
    </div>
  );
}
