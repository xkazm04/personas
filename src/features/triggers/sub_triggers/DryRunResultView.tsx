import { X, CheckCircle2, Zap, ArrowRight, Radio, FlaskConical } from 'lucide-react';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';
import { useTranslation } from '@/i18n/useTranslation';

interface DryRunResultViewProps {
  detail: ReturnType<typeof useTriggerDetail>;
}

export function DryRunResultView({ detail }: DryRunResultViewProps) {
  const { t, tx } = useTranslation();
  const { dryRunResult, clearDryRunResult } = detail;
  if (!dryRunResult) return null;

  return (
    <div
        className="animate-fade-slide-in overflow-hidden"
      >
        <div className="rounded-modal border border-amber-500/20 bg-amber-500/5 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 typo-body font-medium text-amber-400">
              <FlaskConical className="w-3.5 h-3.5" />
              {t.triggers.dry_run_result_title}
            </div>
            <button onClick={clearDryRunResult} className="p-0.5 hover:bg-amber-500/15 rounded transition-colors">
              <X className="w-3 h-3 text-amber-400/60" />
            </button>
          </div>

          {/* Validation status */}
          <div className={`flex items-center gap-1.5 typo-body ${dryRunResult.valid ? 'text-emerald-400' : 'text-red-400'}`}>
            {dryRunResult.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
            {dryRunResult.valid ? t.triggers.all_checks_passed : t.triggers.validation_failed}
          </div>

          {/* Validation check details when failed */}
          {!dryRunResult.valid && dryRunResult.validation.checks && (
            <div className="space-y-1 pl-5">
              {dryRunResult.validation.checks.filter(c => !c.passed).map((c, i) => (
                <div key={i} className="typo-body text-red-400/80">{c.label}: {c.message}</div>
              ))}
            </div>
          )}

          {/* Simulated Event */}
          {dryRunResult.simulated_event && (
            <div className="space-y-1.5">
              <div className="typo-body text-foreground font-medium">{t.triggers.simulated_event}</div>
              <div className="rounded-card bg-background/40 border border-primary/8 p-2 space-y-1 typo-code font-mono">
                <div className="flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-amber-400/60" />
                  <span className="text-amber-400">{dryRunResult.simulated_event.event_type}</span>
                </div>
                <div className="text-foreground pl-[18px]">
                  {t.triggers.source_colon} {dryRunResult.simulated_event.source_type} / {dryRunResult.simulated_event.source_id.slice(0, 8)}
                </div>
                {dryRunResult.simulated_event.target_persona_name && (
                  <div className="text-foreground pl-[18px]">
                    {t.triggers.dry_run_target_colon} {dryRunResult.simulated_event.target_persona_name}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Matched Subscriptions */}
          {dryRunResult.matched_subscriptions.length > 0 && (
            <div className="space-y-1.5">
              <div className="typo-body text-foreground font-medium">
                {tx(t.triggers.matched_subscriptions_count, { count: dryRunResult.matched_subscriptions.length })}
              </div>
              <div className="space-y-1">
                {dryRunResult.matched_subscriptions.map((sub) => (
                  <div key={sub.subscription_id} className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-background/30 border border-primary/5 typo-body">
                    <Zap className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                    <span className="text-foreground/90 truncate">{sub.persona_name}</span>
                    <ArrowRight className="w-3 h-3 text-foreground flex-shrink-0" />
                    <span className="text-foreground font-mono truncate">{sub.event_type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {dryRunResult.valid && dryRunResult.matched_subscriptions.length === 0 && (
            <div className="typo-body text-foreground italic">
              {t.triggers.no_subscriptions_activated}
            </div>
          )}
        </div>
      </div>
  );
}
