import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ChevronDown, ChevronRight, RotateCw, Copy, Check, RefreshCw, Rocket, Play, Clock, ArrowLeftRight, X, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '@/api/tauriApi';
import { getRetryChain } from '@/api/healing';
import { formatTimestamp, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { FEATURED_TEMPLATES } from '@/lib/personas/templateCatalog';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';
import { ExecutionComparison } from './ExecutionComparison';
import { maskSensitiveJson, sanitizeErrorMessage } from '@/lib/utils/maskSensitive';

/** Inline 48x16 SVG sparkline for cost trend. No charting library needed. */
function CostSparkline({ costs }: { costs: number[] }) {
  if (costs.length < 2) return null;

  const W = 48;
  const H = 16;
  const PAD = 1;

  const min = Math.min(...costs);
  const max = Math.max(...costs);
  const range = max - min || 1;

  const points = costs.map((c, i) => {
    const x = PAD + (i / (costs.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((c - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Highlight last point amber if it exceeds 2x the median
  const sorted = [...costs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const lastCost = costs[costs.length - 1]!;
  const isSpike = lastCost > median * 2;

  const lastX = PAD + ((costs.length - 1) / (costs.length - 1)) * (W - PAD * 2);
  const lastY = H - PAD - ((lastCost - min) / range) * (H - PAD * 2);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="inline-block align-middle flex-shrink-0"
      data-testid="cost-sparkline"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="rgb(161 161 170)" // zinc-400
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {isSpike && (
        <circle
          cx={lastX.toFixed(1)}
          cy={lastY.toFixed(1)}
          r="2"
          fill="rgb(251 191 36)" // amber-400
        />
      )}
    </svg>
  );
}

const TEMPLATE_SAMPLE_INPUT: Record<string, object> = {
  'gmail-maestro': { mode: 'process_inbox', max_emails: 5, labels: ['inbox', 'unread'] },
  'code-reviewer': { repo: 'owner/repo', pr_number: 42 },
  'slack-standup': { channel: '#team-standup', lookback_hours: 24 },
  'security-auditor': { target_path: './src', scan_type: 'full' },
  'doc-writer': { source_path: './src', output_format: 'markdown' },
  'test-generator': { module_path: './src/utils/helpers.ts', framework: 'vitest' },
  'dep-updater': { manifest: 'package.json', check_security: true },
  'bug-triager': { issue_id: 'BUG-1234', source: 'github' },
  'data-monitor': { pipeline: 'etl-daily', check_interval_min: 5 },
};

export function ExecutionList() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const setRerunInputData = usePersonaStore((state) => state.setRerunInputData);
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevIsExecutingRef = useRef(isExecuting);

  const [showRaw, setShowRaw] = useState(false);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const personaId = selectedPersona?.id || '';

  const sampleInput = useMemo(() => {
    if (!selectedPersona) return '{}';
    const match = FEATURED_TEMPLATES.find(
      (t) => t.name === selectedPersona.name,
    );
    const data = match ? TEMPLATE_SAMPLE_INPUT[match.id] ?? {} : {};
    return JSON.stringify(data, null, 2);
  }, [selectedPersona]);

  const handleTryIt = () => {
    setRerunInputData(sampleInput === '{}' ? '{}' : sampleInput);
  };

  const fetchExecutions = async () => {
    if (!personaId) return;
    setLoading(true);
    try {
      const data = await api.listExecutions(personaId);
      setExecutions(data || []);
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (personaId) {
      fetchExecutions();
    }
  }, [personaId]);

  // Re-fetch when execution finishes (isExecuting transitions true -> false)
  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && personaId) {
      fetchExecutions();
    }
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, personaId]);

  // Auto-suggest retry comparison: when an execution with retries is expanded
  const handleAutoCompareRetry = useCallback(async (executionId: string) => {
    if (!personaId) return;
    try {
      const chain = await getRetryChain(executionId, personaId);
      if (chain.length >= 2) {
        // Compare original (first) vs latest retry (last)
        setCompareLeft(chain[0]!.id);
        setCompareRight(chain[chain.length - 1]!.id);
        setCompareMode(true);
      }
    } catch {
      // Silently ignore - chain may not exist
    }
  }, [personaId]);

  const handleCompareSelect = (executionId: string) => {
    if (!compareLeft) {
      setCompareLeft(executionId);
    } else if (!compareRight && executionId !== compareLeft) {
      setCompareRight(executionId);
    } else {
      // Reset and start new selection
      setCompareLeft(executionId);
      setCompareRight(null);
    }
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setCompareLeft(null);
    setCompareRight(null);
    setShowComparison(false);
  };

  const canCompare = compareLeft && compareRight && compareLeft !== compareRight;

  const leftExec = useMemo(
    () => executions.find(e => e.id === compareLeft) ?? null,
    [executions, compareLeft],
  );
  const rightExec = useMemo(
    () => executions.find(e => e.id === compareRight) ?? null,
    [executions, compareRight],
  );

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const formatTokens = (tokens: number) => {
    if (tokens === 0) return '-';
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const handleRowClick = (executionId: string) => {
    if (compareMode) {
      handleCompareSelect(executionId);
      return;
    }
    setExpandedId(expandedId === executionId ? null : executionId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Show comparison view
  if (showComparison && leftExec && rightExec) {
    return (
      <div className="space-y-3">
        <ExecutionComparison
          left={leftExec}
          right={rightExec}
          onClose={exitCompareMode}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          History
        </h4>
        {executions.length > 0 && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`ml-auto flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg transition-colors ${
              showRaw
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
            }`}
            title={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}
          >
            <Shield className="w-3 h-3" />
            {showRaw ? 'Raw' : 'Masked'}
          </button>
        )}
        {executions.length >= 2 && (
          <button
            onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg transition-colors ${
              compareMode
                ? 'bg-primary/15 text-primary/80 border border-primary/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
            }`}
          >
            {compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
            {compareMode ? 'Cancel' : 'Compare'}
          </button>
        )}
      </div>

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/15 rounded-xl text-sm">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-muted-foreground/70">
            {!compareLeft
              ? 'Select the first execution to compare'
              : !compareRight
                ? 'Now select the second execution'
                : 'Ready to compare'}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-xs font-mono text-indigo-400">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-muted-foreground/40">vs</span>
                  <span className="text-xs font-mono text-pink-400">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <button
              onClick={() => setShowComparison(true)}
              className="ml-2 px-2.5 py-1 text-xs font-medium rounded-lg bg-primary/15 text-primary/80 border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              Compare
            </button>
          )}
        </div>
      )}

      {executions.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl"
        >
          <div className="w-12 h-12 rounded-2xl bg-primary/8 border border-primary/12 flex items-center justify-center mb-4">
            <Rocket className="w-5.5 h-5.5 text-primary/40" />
          </div>
          <p className="text-sm font-medium text-foreground/80">
            Your agent is ready to go
          </p>
          <p className="text-sm text-muted-foreground/80 mt-1 max-w-[260px]">
            Run it to see results here. Each execution will appear in this timeline.
          </p>
          <button
            onClick={handleTryIt}
            className="mt-5 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/15 hover:bg-primary/20 hover:text-primary transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Try it now
          </button>
        </motion.div>
      ) : (
        <div className="overflow-hidden border border-primary/15 rounded-xl backdrop-blur-sm bg-secondary/40">
          {/* Header (desktop only) */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2.5 bg-primary/8 border-b border-primary/10 text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">
            {compareMode && <div className="col-span-1" />}
            <div className={compareMode ? 'col-span-2' : 'col-span-2'}>Status</div>
            <div className="col-span-2">Duration</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Started</div>
            <div className="col-span-2">Tokens</div>
            <div className={compareMode ? 'col-span-2' : 'col-span-3'}>Cost</div>
          </div>

          {/* Rows */}
          {executions.map((execution, execIdx) => {
            const isExpanded = expandedId === execution.id && !compareMode;
            const isCompareSelected = compareLeft === execution.id || compareRight === execution.id;
            const compareLabel = compareLeft === execution.id ? 'A' : compareRight === execution.id ? 'B' : null;

            const chevron = compareMode ? null : isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
            );

            const statusEntry = getStatusEntry(execution.status);
            const statusBadge = (
              <span className={`px-2 py-0.5 rounded-md text-sm font-medium ${badgeClass(statusEntry)}`}>
                {statusEntry.label}
              </span>
            );

            const retryBadge = execution.retry_count > 0 ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
                <RefreshCw className="w-2.5 h-2.5" />
                #{execution.retry_count}
              </span>
            ) : null;

            const duration = (
              <span className="text-sm text-foreground/90 font-mono">
                {formatDuration(execution.duration_ms)}
              </span>
            );

            return (
              <div key={execution.id}>
                {/* Desktop table row (md+) */}
                <motion.div
                  onClick={() => handleRowClick(execution.id)}
                  className={`hidden md:grid grid-cols-12 gap-4 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
                    isCompareSelected
                      ? 'bg-primary/10 border-l-2 border-l-primary/40'
                      : 'bg-background/30 hover:bg-secondary/20'
                  }`}
                >
                  {compareMode && (
                    <div className="col-span-1 flex items-center">
                      {compareLabel ? (
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                          compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                        }`}>
                          {compareLabel}
                        </span>
                      ) : (
                        <span className="w-5 h-5 rounded-md border border-primary/15 bg-background/30" />
                      )}
                    </div>
                  )}
                  <div className={`${compareMode ? 'col-span-2' : 'col-span-2'} flex items-center gap-2`}>
                    {chevron}
                    {statusBadge}
                    {retryBadge}
                  </div>
                  <div className="col-span-2 flex items-center">
                    {duration}
                  </div>
                  <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} text-sm text-foreground/90 flex items-center`}>
                    {formatTimestamp(execution.started_at)}
                  </div>
                  <div className="col-span-2 text-sm text-foreground/90 font-mono flex items-center">
                    <span title="Input tokens">{formatTokens(execution.input_tokens)}</span>
                    {' / '}
                    <span title="Output tokens">{formatTokens(execution.output_tokens)}</span>
                  </div>
                  <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} flex items-center gap-2`}>
                    <span className="text-sm text-foreground/90 font-mono">
                      ${execution.cost_usd.toFixed(4)}
                    </span>
                    {!compareMode && (
                      <CostSparkline
                        costs={executions
                          .slice(execIdx, Math.min(executions.length, execIdx + 10))
                          .map((e) => e.cost_usd)
                          .reverse()}
                      />
                    )}
                  </div>
                </motion.div>

                {/* Mobile card layout (<md) */}
                <div
                  onClick={() => handleRowClick(execution.id)}
                  className={`flex md:hidden flex-col gap-1.5 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
                    isCompareSelected ? 'bg-primary/10' : 'bg-background/30 hover:bg-secondary/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {compareMode && compareLabel && (
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                        compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                      }`}>
                        {compareLabel}
                      </span>
                    )}
                    {chevron}
                    {statusBadge}
                    {retryBadge}
                    {duration}
                    <span className="text-sm text-muted-foreground/80 ml-auto">
                      {formatRelativeTime(execution.started_at)}
                    </span>
                  </div>
                  {execution.error_message && (
                    <p className="text-sm text-red-400/70 truncate pl-5.5">
                      {showRaw ? execution.error_message : sanitizeErrorMessage(execution.error_message)}
                    </p>
                  )}
                </div>

                {/* Expanded Detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-b border-primary/10 bg-secondary/20"
                    >
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Execution ID</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(execution.id);
                                setCopiedId(execution.id);
                              }}
                              className="flex items-center gap-1.5 mt-0.5 text-foreground/90 hover:text-foreground/95 transition-colors group"
                              title={execution.id}
                            >
                              <span className="font-mono text-sm">#{execution.id.slice(0, 8)}</span>
                              {hasCopied && copiedId === execution.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                              )}
                            </button>
                          </div>
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Model</span>
                            <p className="text-foreground/90 text-sm mt-0.5">{execution.model_used || 'default'}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Input Tokens</span>
                            <p className="text-foreground/90 font-mono text-sm mt-0.5">{execution.input_tokens.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Output Tokens</span>
                            <p className="text-foreground/90 font-mono text-sm mt-0.5">{execution.output_tokens.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Cost</span>
                            <p className="text-foreground/90 font-mono text-sm mt-0.5">${execution.cost_usd.toFixed(4)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Completed</span>
                            <p className="text-foreground/90 text-sm mt-0.5">{formatTimestamp(execution.completed_at)}</p>
                          </div>
                        </div>
                        {execution.input_data && (
                          <div>
                            <span className="text-muted-foreground/90 text-sm font-mono uppercase">Input Data</span>
                            <pre className="mt-1 p-2 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/80 font-mono overflow-x-auto">
                              {showRaw ? execution.input_data : maskSensitiveJson(execution.input_data)}
                            </pre>
                          </div>
                        )}
                        {execution.error_message && (
                          <div>
                            <span className="text-red-400/70 text-sm font-mono uppercase">Error</span>
                            <p className="mt-1 text-sm text-red-400/80">{showRaw ? execution.error_message : sanitizeErrorMessage(execution.error_message)}</p>
                          </div>
                        )}
                        {/* Action buttons */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRerunInputData(execution.input_data || '{}');
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/10 text-primary/80 border border-primary/15 hover:bg-primary/20 hover:text-primary transition-colors"
                          >
                            <RotateCw className="w-3 h-3" />
                            Re-run with same input
                          </button>
                          {execution.retry_count > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleAutoCompareRetry(execution.id);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              Compare with original
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
