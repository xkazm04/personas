import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { getCompositePartialMatch } from '@/api/pipeline/triggers';
import type { PartialMatchResult } from '@/lib/bindings/PartialMatchResult';

interface Props {
  triggerId: string;
}

export function CompositePartialMatchIndicator({ triggerId }: Props) {
  const [result, setResult] = useState<PartialMatchResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getCompositePartialMatch(triggerId).then((r) => {
        if (!cancelled) setResult(r);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [triggerId]);

  if (!result) return null;

  const { conditionsMet, conditionsTotal, fired, suppressed, operator, conditionDetails } = result;
  const ratio = conditionsTotal > 0 ? conditionsMet / conditionsTotal : 0;

  // Color coding: green if fired, amber for near-miss (>0 met), muted for nothing
  const color = fired
    ? 'text-emerald-400'
    : conditionsMet > 0
      ? 'text-amber-400'
      : 'text-muted-foreground/60';

  const bgColor = fired
    ? 'bg-emerald-500/10 border-emerald-500/15'
    : conditionsMet > 0
      ? 'bg-amber-500/10 border-amber-500/15'
      : 'bg-secondary/30 border-border/30';

  return (
    <div className={`rounded-xl border p-2.5 space-y-2 ${bgColor}`}>
      <div className="flex items-center gap-1.5">
        <Activity className={`w-3.5 h-3.5 ${color}`} />
        <span className={`text-sm font-medium ${color}`}>
          {conditionsMet}/{conditionsTotal} conditions met
        </span>
        <span className="text-xs text-muted-foreground/60 ml-auto">
          {operator.toUpperCase()}
        </span>
        {suppressed && (
          <span className="text-xs text-muted-foreground/50 italic">suppressed</span>
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
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className={c.matched ? 'text-emerald-400' : 'text-muted-foreground/50'}>
              {c.matched ? '\u2713' : '\u2717'}
            </span>
            <span className={`font-mono ${c.matched ? 'text-foreground/80' : 'text-muted-foreground/50'}`}>
              {c.eventType}
            </span>
            {c.sourceFilter && (
              <span className="text-muted-foreground/40">({c.sourceFilter})</span>
            )}
            {c.matched && c.matchedEventCount > 1 && (
              <span className="text-muted-foreground/50">&times;{c.matchedEventCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
