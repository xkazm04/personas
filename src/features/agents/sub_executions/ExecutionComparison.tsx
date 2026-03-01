import { useState, useEffect, useMemo, useCallback } from 'react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import {
  ArrowLeftRight, Zap, Hash,
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronRight, X, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, formatTimestamp, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { getExecutionLog } from '@/api/executions';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

interface ExecutionComparisonProps {
  left: PersonaExecution;
  right: PersonaExecution;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pctChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / a) * 100;
}

function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(v: number): string {
  return v < 0.001 ? '<$0.001' : `$${v.toFixed(4)}`;
}

function deltaIcon(pct: number) {
  if (Math.abs(pct) < 5) return <Minus className="w-3 h-3 text-muted-foreground/60" />;
  if (pct < 0) return <TrendingDown className="w-3 h-3 text-emerald-400" />;
  return <TrendingUp className="w-3 h-3 text-amber-400" />;
}

function deltaColor(pct: number, lowerIsBetter = true): string {
  if (Math.abs(pct) < 5) return 'text-muted-foreground/70';
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return good ? 'text-emerald-400' : 'text-amber-400';
}

/** Simple word-level diff for terminal output lines. */
function diffLines(linesA: string[], linesB: string[]): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  const result: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  // Walk through A to find removed/same
  for (const line of linesA) {
    if (setB.has(line)) {
      result.push({ type: 'same', text: line });
    } else {
      result.push({ type: 'removed', text: line });
    }
  }
  // Walk through B to find added
  for (const line of linesB) {
    if (!setA.has(line)) {
      result.push({ type: 'added', text: line });
    }
  }
  return result;
}

/** Structural diff of two JSON strings. */
function jsonDiff(a: string | null, b: string | null): Array<{ path: string; left: string; right: string }> {
  const diffs: Array<{ path: string; left: string; right: string }> = [];
  try {
    const objA = a ? JSON.parse(a) : {};
    const objB = b ? JSON.parse(b) : {};
    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      const valA = JSON.stringify(objA[key] ?? null);
      const valB = JSON.stringify(objB[key] ?? null);
      if (valA !== valB) {
        diffs.push({ path: key, left: valA, right: valB });
      }
    }
  } catch {
    if (a !== b) {
      diffs.push({ path: '(root)', left: a ?? '(empty)', right: b ?? '(empty)' });
    }
  }
  return diffs;
}

// ─── What Changed Summary ────────────────────────────────────────────────────

function generateWhatChanged(left: PersonaExecution, right: PersonaExecution): string[] {
  const changes: string[] = [];
  const rightLabel = right.retry_count > 0 ? `retry #${right.retry_count}` : 'original';

  // Token comparison
  const totalLeft = left.input_tokens + left.output_tokens;
  const totalRight = right.input_tokens + right.output_tokens;
  if (totalLeft > 0 && totalRight > 0) {
    const tokenPct = pctChange(totalLeft, totalRight);
    if (Math.abs(tokenPct) >= 10) {
      changes.push(
        tokenPct < 0
          ? `Right (${rightLabel}) used ${Math.abs(tokenPct).toFixed(0)}% fewer tokens`
          : `Right (${rightLabel}) used ${tokenPct.toFixed(0)}% more tokens`
      );
    }
  }

  // Cost comparison
  if (left.cost_usd > 0 && right.cost_usd > 0) {
    const costPct = pctChange(left.cost_usd, right.cost_usd);
    if (Math.abs(costPct) >= 10) {
      changes.push(
        costPct < 0
          ? `Right (${rightLabel}) cost ${Math.abs(costPct).toFixed(0)}% less`
          : `Right (${rightLabel}) cost ${costPct.toFixed(0)}% more`
      );
    }
  }

  // Duration comparison
  const durL = left.duration_ms ?? 0;
  const durR = right.duration_ms ?? 0;
  if (durL > 0 && durR > 0) {
    const durPct = pctChange(durL, durR);
    if (Math.abs(durPct) >= 20) {
      const ratio = durR / durL;
      changes.push(
        durPct > 0
          ? `Right (${rightLabel}) took ${ratio.toFixed(1)}x longer`
          : `Right (${rightLabel}) was ${(1 / ratio).toFixed(1)}x faster`
      );
    }
  }

  // Status change
  if (left.status !== right.status) {
    changes.push(`Status changed: ${left.status} → ${right.status}`);
  }

  // Tool order
  const stepsL = parseToolSteps(left.tool_steps);
  const stepsR = parseToolSteps(right.tool_steps);
  const orderL = stepsL.map(s => s.tool_name).join(',');
  const orderR = stepsR.map(s => s.tool_name).join(',');
  if (orderL && orderR && orderL !== orderR) {
    changes.push('Different tool call order');
  }
  if (stepsL.length !== stepsR.length && (stepsL.length > 0 || stepsR.length > 0)) {
    changes.push(`Tool calls: ${stepsL.length} → ${stepsR.length}`);
  }

  // Model change
  if (left.model_used && right.model_used && left.model_used !== right.model_used) {
    changes.push(`Model changed: ${left.model_used} → ${right.model_used}`);
  }

  if (changes.length === 0) {
    changes.push('No significant differences detected');
  }

  return changes;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricDeltaCard({
  label,
  leftVal,
  rightVal,
  format,
  lowerIsBetter = true,
}: {
  label: string;
  leftVal: number;
  rightVal: number;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  const pct = pctChange(leftVal, rightVal);
  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2.5 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-mono">{label}</div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-foreground/80">{format(leftVal)}</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="text-sm font-mono text-foreground/80">{format(rightVal)}</span>
      </div>
      <div className={`flex items-center gap-1 text-xs font-mono ${deltaColor(pct, lowerIsBetter)}`}>
        {deltaIcon(pct)}
        {fmtPct(pct)}
      </div>
    </div>
  );
}

function ToolTimelineComparison({
  stepsLeft,
  stepsRight,
}: {
  stepsLeft: ToolCallStep[];
  stepsRight: ToolCallStep[];
}) {
  const maxSteps = Math.max(stepsLeft.length, stepsRight.length);
  if (maxSteps === 0) {
    return <p className="text-sm text-muted-foreground/50 text-center py-4">No tool calls</p>;
  }

  return (
    <div className="space-y-1">
      {Array.from({ length: maxSteps }, (_, i) => {
        const l = stepsLeft[i];
        const r = stepsRight[i];
        const durDelta = l?.duration_ms != null && r?.duration_ms != null
          ? r.duration_ms - l.duration_ms
          : null;

        return (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            {/* Left step */}
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm ${l ? 'bg-secondary/40 border border-primary/10' : 'bg-transparent'}`}>
              {l ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-foreground/80 truncate">{l.tool_name}</span>
                  {l.duration_ms != null && (
                    <span className="ml-auto text-xs font-mono text-muted-foreground/60">{formatDuration(l.duration_ms)}</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground/30 text-xs">—</span>
              )}
            </div>

            {/* Delta badge */}
            <div className="w-16 text-center">
              {durDelta != null ? (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  Math.abs(durDelta) < 500 ? 'text-muted-foreground/50'
                    : durDelta < 0 ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-amber-400 bg-amber-500/10'
                }`}>
                  {durDelta > 0 ? '+' : ''}{formatDuration(durDelta)}
                </span>
              ) : l && r ? (
                <span className="text-muted-foreground/30 text-xs">—</span>
              ) : null}
            </div>

            {/* Right step */}
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm ${r ? 'bg-secondary/40 border border-primary/10' : 'bg-transparent'}`}>
              {r ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-foreground/80 truncate">{r.tool_name}</span>
                  {r.duration_ms != null && (
                    <span className="ml-auto text-xs font-mono text-muted-foreground/60">{formatDuration(r.duration_ms)}</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground/30 text-xs">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutputDiffSection({
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
      // Silently handle - logs may not exist
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
        className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Terminal Output Diff
        {diff.length > 0 && (
          <span className="text-xs text-muted-foreground/50">
            ({diff.filter(d => d.type !== 'same').length} differences)
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading logs...
              </div>
            ) : diff.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-3">No log data available</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-primary/10 bg-background/50 p-2 font-mono text-xs">
                {diff.map((d, i) => (
                  <div
                    key={i}
                    className={
                      d.type === 'added' ? 'text-emerald-400 bg-emerald-500/5'
                        : d.type === 'removed' ? 'text-red-400 bg-red-500/5'
                          : 'text-foreground/60'
                    }
                  >
                    <span className="inline-block w-4 text-center opacity-60">
                      {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '}
                    </span>
                    {d.text}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function JsonDiffSection({
  label,
  leftData,
  rightData,
}: {
  label: string;
  leftData: string | null;
  rightData: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const diffs = useMemo(() => jsonDiff(leftData, rightData), [leftData, rightData]);

  if (diffs.length === 0 && !leftData && !rightData) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label}
        {diffs.length > 0 ? (
          <span className="text-xs text-amber-400/70">{diffs.length} diff{diffs.length > 1 ? 's' : ''}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">identical</span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            {diffs.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-2">No differences</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {diffs.map((d, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs font-mono items-start">
                    <span className="text-muted-foreground/50 py-1">{d.path}</span>
                    <div className="px-2 py-1 rounded bg-red-500/5 text-red-400/80 break-all">{d.left}</div>
                    <div className="px-2 py-1 rounded bg-emerald-500/5 text-emerald-400/80 break-all">{d.right}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ExecutionComparison({ left, right, onClose }: ExecutionComparisonProps) {
  const stepsLeft = useMemo(() => parseToolSteps(left.tool_steps), [left.tool_steps]);
  const stepsRight = useMemo(() => parseToolSteps(right.tool_steps), [right.tool_steps]);
  const whatChanged = useMemo(() => generateWhatChanged(left, right), [left, right]);

  const leftStatus = getStatusEntry(left.status);
  const rightStatus = getStatusEntry(right.status);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-medium text-foreground/80">Execution Comparison</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* What Changed summary */}
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-primary/60" />
          <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">What Changed</span>
        </div>
        <ul className="space-y-1">
          {whatChanged.map((change, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="w-1 h-1 rounded-full bg-primary/40 mt-2 flex-shrink-0" />
              {change}
            </li>
          ))}
        </ul>
      </div>

      {/* Execution headers (side by side) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground/50">Left</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badgeClass(leftStatus)}`}>{leftStatus.label}</span>
            {left.retry_count > 0 && (
              <span className="text-xs text-cyan-400 font-mono">retry #{left.retry_count}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground/60 font-mono">#{left.id.slice(0, 8)}</div>
          <div className="text-xs text-muted-foreground/40 mt-0.5">{formatTimestamp(left.started_at)}</div>
        </div>
        <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase text-muted-foreground/50">Right</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badgeClass(rightStatus)}`}>{rightStatus.label}</span>
            {right.retry_count > 0 && (
              <span className="text-xs text-cyan-400 font-mono">retry #{right.retry_count}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground/60 font-mono">#{right.id.slice(0, 8)}</div>
          <div className="text-xs text-muted-foreground/40 mt-0.5">{formatTimestamp(right.started_at)}</div>
        </div>
      </div>

      {/* Metrics delta cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricDeltaCard
          label="Input Tokens"
          leftVal={left.input_tokens}
          rightVal={right.input_tokens}
          format={fmtTokens}
        />
        <MetricDeltaCard
          label="Output Tokens"
          leftVal={left.output_tokens}
          rightVal={right.output_tokens}
          format={fmtTokens}
        />
        <MetricDeltaCard
          label="Cost"
          leftVal={left.cost_usd}
          rightVal={right.cost_usd}
          format={fmtCost}
        />
        <MetricDeltaCard
          label="Duration"
          leftVal={left.duration_ms ?? 0}
          rightVal={right.duration_ms ?? 0}
          format={(v) => formatDuration(v)}
        />
      </div>

      {/* Tool call timeline comparison */}
      {(stepsLeft.length > 0 || stepsRight.length > 0) && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-3.5 h-3.5 text-primary/50" />
            <span className="text-xs font-medium text-foreground/70 uppercase tracking-wider">Tool Call Timeline</span>
          </div>
          <ToolTimelineComparison stepsLeft={stepsLeft} stepsRight={stepsRight} />
        </div>
      )}

      {/* Terminal output diff */}
      <OutputDiffSection leftId={left.id} rightId={right.id} personaId={left.persona_id} />

      {/* Input data diff */}
      <JsonDiffSection label="Input Data Diff" leftData={left.input_data} rightData={right.input_data} />

      {/* Output data diff */}
      <JsonDiffSection label="Output Data Diff" leftData={left.output_data} rightData={right.output_data} />
    </div>
  );
}
