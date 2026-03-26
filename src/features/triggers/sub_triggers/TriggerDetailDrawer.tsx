import { Trash2, X, Check, Play, Terminal, FlaskConical } from 'lucide-react';
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
            className={`animate-fade-slide-in px-2.5 py-1.5 rounded-xl text-sm font-mono ${
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
            {detail.copiedCurl ? 'Copied!' : 'Copy sample curl'}
          </button>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-1">
          {/* Testing actions group */}
          <div className="flex items-center gap-0.5 rounded-xl bg-secondary/20 p-1">
            <button
              onClick={detail.handleTestFire}
              disabled={detail.testing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
              title="Validate trigger config, then fire"
            >
              {detail.testing ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
              {detail.testing ? 'Validating...' : 'Test fire'}
            </button>

            <button
              onClick={detail.handleDryRun}
              disabled={detail.dryRunning || detail.testing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
              title="Simulate trigger without executing"
            >
              {detail.dryRunning ? <LoadingSpinner size="sm" /> : <FlaskConical className="w-4 h-4" />}
              {detail.dryRunning ? 'Simulating...' : 'Dry run'}
            </button>
          </div>

          <div className="flex-1" />

          {/* Divider */}
          <div className="h-6 w-px bg-primary/10" />

          {/* Destructive actions group */}
          <div className="flex items-center rounded-xl bg-red-500/5 p-1">
            {detail.confirmingDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={() => detail.confirmDelete(onDelete)} className="p-2 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors" title="Confirm delete">
                  <Check className="w-4 h-4 text-red-400" />
                </button>
                <button onClick={detail.cancelDelete} className="p-2 hover:bg-secondary/60 rounded-lg transition-colors" title="Cancel">
                  <X className="w-4 h-4 text-muted-foreground/90" />
                </button>
              </div>
            ) : (
              <button onClick={detail.startDeleteConfirm} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Delete trigger">
                <Trash2 className="w-4 h-4" />Delete
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
