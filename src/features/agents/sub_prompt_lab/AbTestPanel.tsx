import { useState } from 'react';
import { Loader2, Play, FlaskConical, XCircle, ArrowDown } from 'lucide-react';
import { runPromptAbTest } from '@/api/overview/observability';
import { useToastStore } from '@/stores/toastStore';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import type { PromptAbTestResult } from '@/lib/bindings/PromptAbTestResult';

interface AbTestPanelProps {
  personaId: string;
  compareA: PersonaPromptVersion | null;
  compareB: PersonaPromptVersion | null;
}

export function AbTestPanel({ personaId, compareA, compareB }: AbTestPanelProps) {
  const [testInput, setTestInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptAbTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const completedBoth = !!result
    && result.result_a.status === 'completed'
    && result.result_b.status === 'completed';
  const score = (r: PromptAbTestResult['result_a']) => (r.duration_ms ?? Number.POSITIVE_INFINITY) + (r.cost_usd ?? Number.POSITIVE_INFINITY) * 1000;
  const winner = completedBoth
    ? (score(result.result_a) <= score(result.result_b) ? 'A' : 'B')
    : null;

  const metricDelta = (label: 'A' | 'B', metric: 'duration' | 'cost') => {
    if (!completedBoth || !result) return null;
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

  const handleRun = async () => {
    if (!compareA || !compareB) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runPromptAbTest(
        personaId,
        compareA.id,
        compareB.id,
        testInput.trim() || undefined,
      );
      setResult(res);
      addToast('A/B test completed successfully', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!compareA || !compareB) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <div className="w-12 h-12 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center">
          <FlaskConical className="w-6 h-6 text-primary/30" />
        </div>
        <h4 className="text-sm font-medium text-foreground/70">A/B test your prompts</h4>
        <p className="text-sm text-muted-foreground/50 text-center max-w-xs">
          Compare two prompt versions head-to-head. See which one performs better on cost, speed, and output quality.
        </p>
        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground/60">
          <span>Select</span>
          <span className="font-mono bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">A</span>
          <span>&</span>
          <span className="font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">B</span>
          <span>versions to begin</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono">v{compareA.version_number}</span>
        <span className="text-muted-foreground/60">vs</span>
        <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 font-mono">v{compareB.version_number}</span>
      </div>

      <div>
        <label className="text-sm text-muted-foreground/70 block mb-1">Test Input (optional JSON)</label>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder='{"task": "Summarize the latest sales report"}'
          data-testid="ab-test-input"
          className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/20 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
        />
      </div>

      <button
        onClick={() => void handleRun()}
        disabled={running}
        data-testid="ab-test-run-btn"
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 text-sm font-medium"
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {running ? 'Running A/B Test...' : 'Run A/B Test'}
      </button>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h5 className="text-sm font-semibold text-red-400">A/B Test Failed</h5>
            <p className="text-sm text-red-300/90 leading-relaxed">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400/50 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {result && (
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
                      {r.duration_ms != null ? `${r.duration_ms}ms` : '--'}
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
      )}
    </div>
  );
}
