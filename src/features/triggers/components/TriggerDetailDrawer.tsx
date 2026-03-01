import { Trash2, Zap, X, Check, Copy, CheckCircle2, Play, Loader2, Terminal, ChevronDown, ChevronRight, History, FlaskConical, ArrowRight, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DbPersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatInterval, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';

// ─── Types ──────────────────────────────────────────────────────────────

interface TriggerDetailDrawerProps {
  trigger: DbPersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  detail: ReturnType<typeof useTriggerDetail>;
  onDelete: (triggerId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getWebhookUrl(triggerId: string) {
  return `http://localhost:9420/webhook/${triggerId}`;
}

// ─── Config Section ─────────────────────────────────────────────────────

function ConfigSection({ trigger, credentialEventsList, detail }: Pick<TriggerDetailDrawerProps, 'trigger' | 'credentialEventsList' | 'detail'>) {
  const config = parseTriggerConfig(trigger.trigger_type, trigger.config);

  return (
    <div className="text-sm text-muted-foreground/90 space-y-1">
      {config.type === 'schedule' && config.cron && (
        <div>Cron: <code className="px-1.5 py-0.5 bg-background/50 border border-border/20 rounded text-sm font-mono">{config.cron}</code></div>
      )}
      {(config.type === 'schedule' || config.type === 'polling') && config.interval_seconds && !(config.type === 'schedule' && config.cron) && (
        <div>Interval: {formatInterval(config.interval_seconds)}</div>
      )}
      {config.type === 'polling' && config.event_id && (
        <div className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-400/60" />
          Event: {credentialEventsList.find(e => e.id === config.event_id)?.name || config.event_id}
        </div>
      )}
      {config.type === 'polling' && config.endpoint && (
        <div className="truncate">Endpoint: {config.endpoint}</div>
      )}
      {config.type === 'event_listener' && (
        <>
          <div>Listens for: <code className="px-1.5 py-0.5 bg-background/50 border border-border/20 rounded text-sm font-mono">{config.listen_event_type || 'any'}</code></div>
          {config.source_filter && (
            <div>Source filter: <code className="px-1.5 py-0.5 bg-background/50 border border-border/20 rounded text-sm font-mono">{config.source_filter}</code></div>
          )}
        </>
      )}
      {config.type === 'webhook' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg cursor-text select-all"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-sm text-muted-foreground/90 font-mono break-all">
                {getWebhookUrl(trigger.id)}
              </span>
            </div>
            <button
              onClick={detail.copyWebhookUrl}
              className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
                detail.copiedUrl
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'hover:bg-secondary/60 text-muted-foreground/90 hover:text-muted-foreground'
              }`}
              title="Copy webhook URL"
            >
              {detail.copiedUrl ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          {config.webhook_secret && (
            <div className="text-sm text-muted-foreground/80">
              HMAC: {'--------'}{config.webhook_secret.slice(-4)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dry Run Result ─────────────────────────────────────────────────────

function DryRunResultView({ detail }: { detail: ReturnType<typeof useTriggerDetail> }) {
  const { dryRunResult, clearDryRunResult } = detail;
  if (!dryRunResult) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium text-amber-400">
              <FlaskConical className="w-3.5 h-3.5" />
              Dry Run Result
            </div>
            <button onClick={clearDryRunResult} className="p-0.5 hover:bg-amber-500/15 rounded transition-colors">
              <X className="w-3 h-3 text-amber-400/60" />
            </button>
          </div>

          {/* Validation status */}
          <div className={`flex items-center gap-1.5 text-sm ${dryRunResult.valid ? 'text-emerald-400' : 'text-red-400'}`}>
            {dryRunResult.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
            {dryRunResult.valid ? 'All checks passed' : 'Validation failed'}
          </div>

          {/* Validation check details when failed */}
          {!dryRunResult.valid && dryRunResult.validation.checks && (
            <div className="space-y-1 pl-5">
              {dryRunResult.validation.checks.filter(c => !c.passed).map((c, i) => (
                <div key={i} className="text-sm text-red-400/80">
                  {c.label}: {c.message}
                </div>
              ))}
            </div>
          )}

          {/* Simulated Event */}
          {dryRunResult.simulated_event && (
            <div className="space-y-1.5">
              <div className="text-sm text-muted-foreground/90 font-medium">Simulated Event</div>
              <div className="rounded-lg bg-background/40 border border-primary/8 p-2 space-y-1 text-sm font-mono">
                <div className="flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-amber-400/60" />
                  <span className="text-amber-400">{dryRunResult.simulated_event.event_type}</span>
                </div>
                <div className="text-muted-foreground/70 pl-[18px]">
                  source: {dryRunResult.simulated_event.source_type} / {dryRunResult.simulated_event.source_id.slice(0, 8)}
                </div>
                {dryRunResult.simulated_event.target_persona_name && (
                  <div className="text-muted-foreground/70 pl-[18px]">
                    target: {dryRunResult.simulated_event.target_persona_name}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Matched Subscriptions */}
          {dryRunResult.matched_subscriptions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-sm text-muted-foreground/90 font-medium">
                Matched Subscriptions ({dryRunResult.matched_subscriptions.length})
              </div>
              <div className="space-y-1">
                {dryRunResult.matched_subscriptions.map((sub) => (
                  <div key={sub.subscription_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-sm">
                    <Zap className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                    <span className="text-foreground/90 truncate">{sub.persona_name}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                    <span className="text-muted-foreground/70 font-mono truncate">{sub.event_type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chain Targets */}
          {dryRunResult.chain_targets.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-sm text-muted-foreground/90 font-medium">
                Chain Targets ({dryRunResult.chain_targets.length})
              </div>
              <div className="space-y-1">
                {dryRunResult.chain_targets.map((chain) => (
                  <div key={chain.trigger_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-sm">
                    <ArrowRight className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
                    <span className="text-foreground/90 truncate">{chain.target_persona_name}</span>
                    <span className={`ml-auto text-sm ${chain.enabled ? 'text-emerald-400/70' : 'text-muted-foreground/40'}`}>
                      {chain.condition_type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {dryRunResult.valid && dryRunResult.matched_subscriptions.length === 0 && dryRunResult.chain_targets.length === 0 && (
            <div className="text-sm text-muted-foreground/60 italic">
              No subscriptions or chain triggers would be activated
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Activity Log ───────────────────────────────────────────────────────

function ActivitySection({ detail }: { detail: ReturnType<typeof useTriggerDetail> }) {
  return (
    <>
      <button
        onClick={detail.toggleActivityLog}
        className="flex items-center gap-1.5 pt-1 border-t border-primary/5 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors w-full"
      >
        {detail.activityOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <History className="w-3 h-3" />
        Activity log
      </button>

      <AnimatePresence>
        {detail.activityOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1">
              {detail.activityLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground/80">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </div>
              ) : detail.activityLog.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground/80">
                  No runs recorded for this trigger yet
                </div>
              ) : (
                detail.activityLog.map((exec) => (
                  <div key={exec.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${badgeClass(getStatusEntry(exec.status))}`}>
                      {getStatusEntry(exec.status).label}
                    </span>
                    <span className="text-muted-foreground/90 font-mono">
                      {formatDuration(exec.duration_ms)}
                    </span>
                    <span className="text-muted-foreground/80 ml-auto">
                      {formatRelativeTime(exec.started_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Main Drawer ────────────────────────────────────────────────────────

/** Expanded detail panel with config, testing actions, dry-run results, and activity log. */
export function TriggerDetailDrawer({ trigger, credentialEventsList, detail, onDelete }: TriggerDetailDrawerProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="px-3 pb-3 space-y-3">
        {/* Divider */}
        <div className="border-t border-primary/8" />

        {/* Config details */}
        <ConfigSection trigger={trigger} credentialEventsList={credentialEventsList} detail={detail} />

        {/* Test Result */}
        {detail.testResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className={`px-2.5 py-1.5 rounded-lg text-sm font-mono ${
              detail.testResult.success
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                : 'bg-red-500/10 text-red-400 border border-red-500/15'
            }`}
          >
            {detail.testResult.success ? '\u2713' : '\u2717'} {detail.testResult.message}
          </motion.div>
        )}

        {/* Dry Run Result */}
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
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
            title="Validate trigger config, then fire"
          >
            {detail.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {detail.testing ? 'Validating...' : 'Test fire'}
          </button>

          <button
            onClick={detail.handleDryRun}
            disabled={detail.dryRunning || detail.testing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
            title="Simulate trigger without executing"
          >
            {detail.dryRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
            {detail.dryRunning ? 'Simulating...' : 'Dry run'}
          </button>

          <div className="flex-1" />

          {detail.confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => detail.confirmDelete(onDelete)}
                className="p-1.5 bg-red-500/15 hover:bg-red-500/25 rounded-lg transition-colors"
                title="Confirm delete"
              >
                <Check className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button
                onClick={detail.cancelDelete}
                className="p-1.5 hover:bg-secondary/60 rounded-lg transition-colors"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground/90" />
              </button>
            </div>
          ) : (
            <button
              onClick={detail.startDeleteConfirm}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Delete trigger"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>

        {/* Activity Log */}
        <ActivitySection detail={detail} />
      </div>
    </motion.div>
  );
}
