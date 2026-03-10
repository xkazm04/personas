import { Trash2, X, Check, Play, Loader2, Terminal, FlaskConical } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import type { TriggerRateLimitConfig } from '@/lib/utils/platform/triggerConstants';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';
import { RateLimitControls } from '../../form/RateLimitControls';
import { TriggerExecutionHistory } from './TriggerExecutionHistory';
import { TRANSITION_NORMAL } from '@/features/templates/animationPresets';
import { ConfigSection } from './TriggerConfigSection';
import { DryRunResultView } from './DryRunResultView';

interface TriggerDetailDrawerProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  detail: ReturnType<typeof useTriggerDetail>;
  onDelete: (triggerId: string) => void;
  rateLimit: TriggerRateLimitConfig;
  rateLimitState?: TriggerRateLimitState | null;
  onRateLimitChange: (updated: TriggerRateLimitConfig) => void;
}

export function TriggerDetailDrawer({ trigger, credentialEventsList, detail, onDelete, rateLimit, rateLimitState, onRateLimitChange }: TriggerDetailDrawerProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={TRANSITION_NORMAL}
      className="overflow-hidden"
    >
      <div className="px-3 pb-3 space-y-3">
        <div className="border-t border-primary/8" />

        <ConfigSection trigger={trigger} credentialEventsList={credentialEventsList} detail={detail} />

        <RateLimitControls rateLimit={rateLimit} runtimeState={rateLimitState} onChange={onRateLimitChange} />

        {/* Test Result */}
        {detail.testResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className={`px-2.5 py-1.5 rounded-xl text-sm font-mono ${
              detail.testResult.success
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                : 'bg-red-500/10 text-red-400 border border-red-500/15'
            }`}
          >
            {detail.testResult.success ? '\u2713' : '\u2717'} {detail.testResult.message}
          </motion.div>
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
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={detail.handleTestFire}
            disabled={detail.testing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-primary/70 hover:text-primary hover:bg-primary/10 rounded-xl transition-colors disabled:opacity-50"
            title="Validate trigger config, then fire"
          >
            {detail.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {detail.testing ? 'Validating...' : 'Test fire'}
          </button>

          <button
            onClick={detail.handleDryRun}
            disabled={detail.dryRunning || detail.testing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 rounded-xl transition-colors disabled:opacity-50"
            title="Simulate trigger without executing"
          >
            {detail.dryRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
            {detail.dryRunning ? 'Simulating...' : 'Dry run'}
          </button>

          <div className="flex-1" />

          {detail.confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={() => detail.confirmDelete(onDelete)} className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors" title="Confirm delete">
                <Check className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button onClick={detail.cancelDelete} className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors" title="Cancel">
                <X className="w-3.5 h-3.5 text-muted-foreground/90" />
              </button>
            </div>
          ) : (
            <button onClick={detail.startDeleteConfirm} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors" title="Delete trigger">
              <Trash2 className="w-3.5 h-3.5" />Delete
            </button>
          )}
        </div>

        <TriggerExecutionHistory triggerId={trigger.id} personaId={trigger.persona_id} />
      </div>
    </motion.div>
  );
}
