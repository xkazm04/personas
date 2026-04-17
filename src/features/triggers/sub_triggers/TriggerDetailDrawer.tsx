import { Trash2, X, Check, Play, Terminal, FlaskConical } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaTrigger } from '@/lib/types/types';
import type { TriggerRateLimitConfig } from '@/lib/utils/platform/triggerConstants';
import { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';
import { RateLimitControls } from './RateLimitControls';
import { ActiveHoursSection } from './ActiveHoursSection';
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

        {/* Test Result */}
        {detail.testResult && (
          <div
            className={`animate-fade-slide-in px-2.5 py-1.5 rounded-modal text-sm font-mono ${
              detail.testResult.success
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                : 'bg-red-500/10 text-red-400 border border-red-500/15'
            }`}
          >
            {detail.testResult.success ? '\u2713' : '\u2717'} {detail.testResult.message}
          </div>
        )}

        <DryRunResultView detail={detail} />

        {/* Curl command for webhooks */}
        {trigger.trigger_type === 'webhook' && (
          <button
            onClick={detail.copyCurlCommand}
            className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
              detail.copiedCurl ? 'text-emerald-400' : 'text-muted-foreground/80 hover:text-muted-foreground'
            }`}
          >
            <Terminal className="w-3 h-3" />
            {detail.copiedCurl ? t.common.copied : t.triggers.copy_sample_curl}
          </button>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-1">
          {/* Testing actions group */}
          <div className="flex items-center gap-0.5 rounded-modal bg-secondary/20 p-1">
            <button
              onClick={detail.handleTestFire}
              disabled={detail.testing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-primary/70 hover:text-primary hover:bg-primary/10 rounded-card transition-colors disabled:opacity-50"
              title="Validate trigger config, then fire"
            >
              {detail.testing ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
              {detail.testing ? t.triggers.detail.validating : t.triggers.test_fire_label}
            </button>

            <button
              onClick={detail.handleDryRun}
              disabled={detail.dryRunning || detail.testing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 rounded-card transition-colors disabled:opacity-50"
              title="Simulate trigger without executing"
            >
              {detail.dryRunning ? <LoadingSpinner size="sm" /> : <FlaskConical className="w-4 h-4" />}
              {detail.dryRunning ? t.triggers.detail.simulating : t.triggers.dry_run_label}
            </button>
          </div>

          <div className="flex-1" />

          {/* Divider */}
          <div className="h-6 w-px bg-primary/10" />

          {/* Destructive actions group */}
          <div className="flex items-center rounded-modal bg-red-500/5 p-1">
            {detail.confirmingDelete ? (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => detail.confirmDelete(onDelete)} title={t.triggers.detail.delete_confirm} className="text-red-400 bg-red-500/15 hover:bg-red-500/25">
                  <Check className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={detail.cancelDelete} title={t.common.cancel}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <button onClick={detail.startDeleteConfirm} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-card transition-colors" title={t.triggers.detail.delete_trigger}>
                <Trash2 className="w-4 h-4" />{t.common.delete}
              </button>
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
