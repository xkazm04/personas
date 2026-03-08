import { ArrowDown } from 'lucide-react';
import type { PromptAbTestResult } from '@/lib/bindings/PromptAbTestResult';

interface AbTestResultsProps {
  result: PromptAbTestResult;
}

export function AbTestResults({ result }: AbTestResultsProps) {
  const completedBoth = result.result_a.status === 'completed' && result.result_b.status === 'completed';
  const score = (r: PromptAbTestResult['result_a']) => (r.duration_ms ?? Number.POSITIVE_INFINITY) + (r.cost_usd ?? Number.POSITIVE_INFINITY) * 1000;
  const winner = completedBoth ? (score(result.result_a) <= score(result.result_b) ? 'A' : 'B') : null;

  const metricDelta = (label: 'A' | 'B', metric: 'duration' | 'cost') => {
    if (!completedBoth) return null;
    const own = label === 'A' ? result.result_a : result.result_b;
    const other = label === 'A' ? result.result_b : result.result_a;
    if (metric === 'duration') {
      if (own.duration_ms == null || other.duration_ms == null) return null;
      const diff = own.duration_ms - other.duration_ms;
      return diff < 0 ? `${diff}ms` : null;
    }
    if (own.cost_usd == null || other.cost_usd == null) return null;
    const diff = own.cost_usd - other.cost_usd;
    return diff < 0 ? `$${diff.toFixed(4)}` : null;
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-foreground/80">Results</h4>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'A', num: result.version_a_number, r: result.result_a, color: 'blue' },
          { label: 'B', num: result.version_b_number, r: result.result_b, color: 'violet' },
        ].map(({ label, num, r, color }) => {
          const isWinner = winner === label;
          const palette = color === 'blue'
            ? {
                card: 'rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2',
                badge: 'px-1.5 py-0.5 rounded text-sm font-mono bg-blue-500/20 text-blue-400',
              }
            : {
                card: 'rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2',
                badge: 'px-1.5 py-0.5 rounded text-sm font-mono bg-violet-500/20 text-violet-400',
              };

          return (
          <div key={label} className={`${palette.card} ${isWinner ? 'bg-emerald-500/5 border-emerald-500/35' : ''}`}>
            <div className="flex items-center gap-2">
              <span className={palette.badge}>{label}</span>
              <span className="text-sm font-mono text-foreground/80">v{num}</span>
              {isWinner && (
                <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-sm font-medium">Winner</span>
              )}
            </div>
            <div className="space-y-1 text-sm text-muted-foreground/80">
              <div className="flex justify-between">
                <span>Status</span>
                <span className={r.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>{r.status}</span>
              </div>
              <div className="flex justify-between">
                <span>Duration</span>
                <span className="inline-flex items-center gap-1">
                  {r.duration_ms != null ? `${r.duration_ms}ms` : '\u2014'}
                  {metricDelta(label as 'A' | 'B', 'duration') && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-400">
                      <ArrowDown className="w-3 h-3" />
                      {metricDelta(label as 'A' | 'B', 'duration')}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Cost</span>
                <span className="inline-flex items-center gap-1">
                  ${r.cost_usd.toFixed(4)}
                  {metricDelta(label as 'A' | 'B', 'cost') && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-400">
                      <ArrowDown className="w-3 h-3" />
                      {metricDelta(label as 'A' | 'B', 'cost')}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tokens</span>
                <span>{r.input_tokens + r.output_tokens}</span>
              </div>
            </div>
            {r.output_preview && (
              <div className="mt-2 p-2 rounded bg-background/40 text-sm text-foreground/70 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                {r.output_preview}
              </div>
            )}
            {r.error_message && (
              <p className="text-sm text-red-400 mt-1">{r.error_message}</p>
            )}
          </div>
        )})}
      </div>
    </div>
  );
}
