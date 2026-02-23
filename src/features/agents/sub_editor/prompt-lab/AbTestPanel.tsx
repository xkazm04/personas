import { useState } from 'react';
import { Loader2, AlertTriangle, Play } from 'lucide-react';
import { runPromptAbTest } from '@/api/observability';
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!compareA || !compareB) {
    return (
      <div className="text-sm text-muted-foreground/60 text-center py-6">
        Select two versions (A and B) to run an A/B test
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
        <label className="text-xs text-muted-foreground/70 block mb-1">Test Input (optional JSON)</label>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder='{"task": "Summarize the latest sales report"}'
          data-testid="ab-test-input"
          className="w-full h-20 px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
        />
      </div>

      <button
        onClick={() => void handleRun()}
        disabled={running}
        data-testid="ab-test-run-btn"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 text-sm font-medium"
      >
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        {running ? 'Running A/B Test...' : 'Run A/B Test'}
      </button>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground/80">Results</h4>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'A', num: result.version_a_number, r: result.result_a, color: 'blue' },
              { label: 'B', num: result.version_b_number, r: result.result_b, color: 'violet' },
            ].map(({ label, num, r, color }) => (
              <div key={label} className={`rounded-lg border border-${color}-500/20 bg-${color}-500/5 p-3 space-y-2`}>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-mono bg-${color}-500/20 text-${color}-400`}>{label}</span>
                  <span className="text-sm font-mono text-foreground/80">v{num}</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground/80">
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className={r.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>{r.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span>{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cost</span>
                    <span>${r.cost_usd.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tokens</span>
                    <span>{r.input_tokens + r.output_tokens}</span>
                  </div>
                </div>
                {r.output_preview && (
                  <div className="mt-2 p-2 rounded bg-background/40 text-xs text-foreground/70 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                    {r.output_preview}
                  </div>
                )}
                {r.error_message && (
                  <p className="text-xs text-red-400 mt-1">{r.error_message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
