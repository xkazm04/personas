import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { getExecutionLog } from '@/api/agents/executions';
import { useToastStore } from '@/stores/toastStore';
import { diffLines } from './comparisonHelpers';

export function OutputDiffSection({
  leftId,
  rightId,
  personaId,
}: {
  leftId: string;
  rightId: string;
  personaId: string;
}) {
  const [logLeft, setLogLeft] = useState<string | null>(null);
  const [logRight, setLogRight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const [l, r] = await Promise.all([
        getExecutionLog(leftId, personaId),
        getExecutionLog(rightId, personaId),
      ]);
      setLogLeft(l);
      setLogRight(r);
    } catch {
      useToastStore.getState().addToast('Failed to load execution logs for comparison', 'error');
    } finally {
      setLoading(false);
    }
  }, [leftId, rightId, personaId]);

  useEffect(() => {
    if (expanded && logLeft === null && logRight === null && !loading) {
      void fetchLogs();
    }
  }, [expanded, logLeft, logRight, loading, fetchLogs]);

  const diff = useMemo(() => {
    if (!logLeft && !logRight) return [];
    const linesL = (logLeft ?? '').split('\n').filter(l => l.trim());
    const linesR = (logRight ?? '').split('\n').filter(l => l.trim());
    return diffLines(linesL, linesR);
  }, [logLeft, logRight]);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 typo-body text-foreground/80 hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="typo-label">Terminal Output Diff</span>
        {diff.length > 0 && (
          <span className="typo-body text-muted-foreground/50">
            ({diff.filter(d => d.type !== 'same').length} differences)
          </span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in mt-2 overflow-hidden"
          >
            {loading ? (
              <div className="flex items-center gap-2 py-4 typo-body text-muted-foreground/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading logs...
              </div>
            ) : diff.length === 0 ? (
              <p className="typo-body text-muted-foreground/50 py-3">No log data available</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-primary/10 bg-background/50 typo-code">
                {diff.reduce<{ elements: React.ReactNode[]; leftLine: number; rightLine: number }>(
                  (acc, d, i) => {
                    const ln = d.type === 'added' ? undefined : ++acc.leftLine;
                    const rn = d.type === 'removed' ? undefined : ++acc.rightLine;
                    acc.elements.push(
                      <div
                        key={i}
                        className={`grid grid-cols-[40px_40px_1fr] ${
                          d.type === 'added' ? 'text-emerald-400 bg-emerald-500/5'
                            : d.type === 'removed' ? 'text-red-400 bg-red-500/5'
                              : 'text-foreground/60'
                        }`}
                      >
                        <span className="select-none text-right pr-2 tabular-nums text-muted-foreground/30">
                          {ln ?? ''}
                        </span>
                        <span className="select-none text-right pr-2 tabular-nums text-muted-foreground/30 border-r border-primary/8">
                          {rn ?? ''}
                        </span>
                        <span className="pl-2">
                          <span className="inline-block w-4 text-center opacity-60">
                            {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '}
                          </span>
                          {d.text}
                        </span>
                      </div>
                    );
                    return acc;
                  },
                  { elements: [], leftLine: 0, rightLine: 0 }
                ).elements}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
