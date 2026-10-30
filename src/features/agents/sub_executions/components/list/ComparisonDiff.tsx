import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getExecutionLogLines } from '@/api/agents/executions';
import { useToastStore } from '@/stores/toastStore';
import {
  computeJsonDiffOffThread,
  computeLineDiffOffThread,
  type JsonDiffEntry,
  type LineDiffEntry,
} from '../../libs/comparisonDiffWorkerClient';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';

const logger = createLogger('comparison-diff');
const LOG_PAGE_SIZE = 500;

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
  const [diff, setDiff] = useState<LineDiffEntry[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  // A diff job that failed is not a diff that found nothing: without this the
  // body fell through to "No log data available" although both logs loaded.
  const [diffFailed, setDiffFailed] = useState(false);
  // A failed load leaves both logs null and `loading` false, which is exactly
  // the condition the fetch effect waits for, so without this latch it re-fired
  // (and re-toasted) in a loop while the section stayed open. Only Retry clears it.
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [l, r] = await Promise.all([
        getExecutionLogLines(leftId, personaId, 0, LOG_PAGE_SIZE),
        getExecutionLogLines(rightId, personaId, 0, LOG_PAGE_SIZE),
      ]);
      setLogLeft(l.join('\n'));
      setLogRight(r.join('\n'));
    } catch (err) {
      logger.warn('Failed to load comparison logs', { error: err });
      useToastStore.getState().addToast(e.failed_to_load_logs, 'error');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [leftId, rightId, personaId, e.failed_to_load_logs]);

  useEffect(() => {
    if (expanded && logLeft === null && logRight === null && !loading && !loadFailed) {
      void fetchLogs();
    }
  }, [expanded, logLeft, logRight, loading, loadFailed, fetchLogs]);

  useEffect(() => {
    if (!expanded || (logLeft === null && logRight === null)) {
      return undefined;
    }

    setDiff([]);
    setDiffLoading(true);
    setDiffFailed(false);
    const job = computeLineDiffOffThread(logLeft, logRight, (chunk) => {
      setDiff((prev) => [...prev, ...chunk]);
    });
    void job.promise
      .then((result) => {
        setDiff(result);
        setDiffLoading(false);
      })
      .catch((err) => {
        silentCatch('ComparisonDiff:computeLineDiffOffThread')(err);
        setDiffLoading(false);
        setDiffFailed(true);
        logger.warn('Failed to compute comparison diff', { error: err });
      });

    return () => job.cancel();
  }, [expanded, logLeft, logRight]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
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
            {loading || (diffLoading && diff.length === 0) ? (
              <ContentLoader variant="panel" hint="comparison" />
            ) : loadFailed ? (
              <div className="flex items-center gap-3 py-3">
                <p className="typo-body text-status-error">{e.failed_to_load_logs}</p>
                <Button variant="secondary" size="sm" onClick={() => { void fetchLogs(); }}>
                  {t.common.retry}
                </Button>
              </div>
            ) : diffFailed ? (
              <p className="typo-body text-status-error py-3">{e.diff_failed}</p>
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
                          d.type === 'added' ? 'text-status-success bg-status-success/5'
                            : d.type === 'removed' ? 'text-status-error bg-status-error/5'
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
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [expanded, setExpanded] = useState(false);
  const [diffs, setDiffs] = useState<JsonDiffEntry[]>([]);
  // `[]` alone cannot say why it is empty. The header used to read "identical"
  // while the off-thread job was still running AND after it failed - a
  // comparison that never ran reported as one that found nothing
  // (diff-comparison / diff-honesty).
  const [diffState, setDiffState] = useState<'pending' | 'done' | 'failed'>('pending');

  useEffect(() => {
    setDiffState('pending');
    const job = computeJsonDiffOffThread(leftData, rightData);
    void job.promise
      .then((result) => {
        setDiffs(result);
        setDiffState('done');
      })
      .catch((err) => {
        silentCatch('ComparisonDiff:computeJsonDiffOffThread')(err);
        setDiffs([]);
        setDiffState('failed');
        logger.warn('Failed to compute JSON comparison diff', { error: err });
      });
    return () => job.cancel();
  }, [leftData, rightData]);

  if (diffs.length === 0 && !leftData && !rightData) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 typo-body text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label}
        {diffState === 'failed' ? (
          <span className="typo-body text-status-error">{e.diff_failed}</span>
        ) : diffState === 'pending' ? null : diffs.length > 0 ? (
          <span className="typo-body text-status-warning/70">
            {tx(diffs.length === 1 ? e.diff_count_one : e.diff_count_other, { count: diffs.length })}
          </span>
        ) : (
          <span className="typo-body text-foreground">{e.identical}</span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in mt-2 overflow-hidden"
          >
            {diffState === 'pending' ? (
              <ContentLoader variant="panel" hint="comparison" />
            ) : diffState === 'failed' ? (
              <p className="typo-body text-status-error py-2">{e.diff_failed}</p>
            ) : diffs.length === 0 ? (
              <p className="typo-body text-foreground py-2">{e.no_differences}</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {diffs.map((d, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-2 typo-code items-start">
                    <span className="text-foreground py-1">{d.path}</span>
                    <div className="px-2 py-1 rounded bg-status-error/5 text-status-error/80 break-all">{d.left}</div>
                    <div className="px-2 py-1 rounded bg-status-success/5 text-status-success/80 break-all">{d.right}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
