import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { getCompositePartialMatch } from '@/api/pipeline/triggers';
import type { PartialMatchResult } from '@/lib/bindings/PartialMatchResult';
import { useTranslation } from '@/i18n/useTranslation';
import { useElementVisible } from '@/hooks/utility/useElementVisible';

interface Props {
  triggerId: string;
}

export function CompositePartialMatchIndicator({ triggerId }: Props) {
  const { t, tx } = useTranslation();
  const [result, setResult] = useState<PartialMatchResult | null>(null);
  // Visibility-gated polling: a 4 s interval with no off-screen pause hammers
  // IPC and the backend regardless of whether the user is looking at the
  // indicator. Trigger lists can render dozens of these simultaneously; on
  // low-battery laptops and locked screens the cumulative IPC churn is
  // wasteful and was previously a real complaint.
  const [containerRef, isVisible] = useElementVisible<HTMLDivElement>();

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const load = () => {
      getCompositePartialMatch(triggerId).then((r) => {
        if (!cancelled) setResult(r);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [triggerId, isVisible]);

  if (!result) return <div ref={containerRef} aria-hidden />;

  const { conditionsMet, conditionsTotal, fired, suppressed, operator, conditionDetails } = result;
  const ratio = conditionsTotal > 0 ? conditionsMet / conditionsTotal : 0;

  // Color coding: green if fired, amber for near-miss (>0 met), muted for nothing
  const color = fired
    ? 'text-emerald-400'
    : conditionsMet > 0
      ? 'text-amber-400'
      : 'text-foreground';

  const bgColor = fired
    ? 'bg-emerald-500/10 border-emerald-500/15'
    : conditionsMet > 0
      ? 'bg-amber-500/10 border-amber-500/15'
      : 'bg-secondary/30 border-border/30';

  return (
    <div ref={containerRef} className={`rounded-modal border p-2.5 space-y-2 ${bgColor}`}>
      <div className="flex items-center gap-1.5">
        <Activity className={`w-3.5 h-3.5 ${color}`} />
        <span className={`typo-body font-medium ${color}`}>
          {tx(t.triggers.conditions_met, { met: conditionsMet, total: conditionsTotal })}
        </span>
        <span className="typo-caption text-foreground ml-auto">
          {operator.toUpperCase()}
        </span>
        {suppressed && (
          <span className="typo-caption text-foreground italic">{t.triggers.suppressed_label}</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-background/30 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            fired ? 'bg-emerald-400' : conditionsMet > 0 ? 'bg-amber-400' : 'bg-muted-foreground/20'
          }`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {/* Per-condition breakdown */}
      <div className="space-y-0.5">
        {conditionDetails.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5 typo-caption">
            <span className={c.matched ? 'text-emerald-400' : 'text-foreground'}>
              {c.matched ? '\u2713' : '\u2717'}
            </span>
            <span className={`font-mono ${c.matched ? 'text-foreground' : 'text-foreground'}`}>
              {c.eventType}
            </span>
            {c.sourceFilter && (
              <span className="text-foreground">({c.sourceFilter})</span>
            )}
            {c.matched && c.matchedEventCount > 1 && (
              <span className="text-foreground">&times;{c.matchedEventCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
