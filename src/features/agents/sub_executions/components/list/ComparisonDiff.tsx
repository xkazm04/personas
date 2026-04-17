import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getExecutionLog } from '@/api/agents/executions';
import { useToastStore } from '@/stores/toastStore';
import { diffLines, jsonDiff } from '../../libs/comparisonHelpers';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { useTranslation } from '@/i18n/useTranslation';

export function OutputDiffSection({
  leftId,
  rightId,
  personaId,
}: {
  leftId: string;
  rightId: string;
  personaId: string;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
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
      useToastStore.getState().addToast(e.failed_to_load_logs, 'error');
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
        className="flex items-center gap-2 typo-body text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {e.terminal_output_diff}
        {diff.length > 0 && (
          <span className="typo-body text-foreground">
            {tx(e.differences_count, { count: diff.filter(d => d.type !== 'same').length })}
          </span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in mt-2 overflow-hidden"
          >
            {loading ? (
              <ContentLoader variant="panel" hint="comparison" />
            ) : diff.length === 0 ? (
              <p className="typo-body text-foreground py-3">{e.no_log_data}</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-card border border-primary/10 bg-background/50 typo-code">
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
                              : 'text-foreground'
                        }`}
                      >
                        <span className="select-none text-right pr-2 tabular-nums text-foreground">
                          {ln ?? ''}
                        </span>
                        <span className="select-none text-right pr-2 tabular-nums text-foreground border-r border-primary/8">
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

export function JsonDiffSection({
  label,
  leftData,
  rightData,
}: {
  label: string;
  leftData: string | null;
  rightData: string | null;
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [expanded, setExpanded] = useState(false);
  const diffs = useMemo(() => jsonDiff(leftData, rightData), [leftData, rightData]);

  if (diffs.length === 0 && !leftData && !rightData) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 typo-body text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label}
        {diffs.length > 0 ? (
          <span className="typo-body text-amber-400/70">{diffs.length} diff{diffs.length > 1 ? 's' : ''}</span>
        ) : (
          <span className="typo-body text-foreground">{e.identical}</span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in mt-2 overflow-hidden"
          >
            {diffs.length === 0 ? (
              <p className="typo-body text-foreground py-2">{e.no_differences}</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {diffs.map((d, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-2 typo-code items-start">
                    <span className="text-foreground py-1">{d.path}</span>
                    <div className="px-2 py-1 rounded bg-red-500/5 text-red-400/80 break-all">{d.left}</div>
                    <div className="px-2 py-1 rounded bg-emerald-500/5 text-emerald-400/80 break-all">{d.right}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
