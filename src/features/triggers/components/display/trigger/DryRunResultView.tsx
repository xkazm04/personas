import { X, CheckCircle2, Zap, ArrowRight, Radio, FlaskConical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';

interface DryRunResultViewProps {
  detail: ReturnType<typeof useTriggerDetail>;
}

export function DryRunResultView({ detail }: DryRunResultViewProps) {
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
                <div key={i} className="text-sm text-red-400/80">{c.label}: {c.message}</div>
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
