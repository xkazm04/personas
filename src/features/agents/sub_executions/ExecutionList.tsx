import { useState, useEffect, useRef, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ChevronDown, ChevronRight, RotateCw, Copy, Check, RefreshCw, Rocket, Play, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '@/api/tauriApi';
import { formatTimestamp, formatDuration, formatRelativeTime, EXECUTION_STATUS_COLORS, badgeClass } from '@/lib/utils/formatters';
import { BUILTIN_TEMPLATES } from '@/lib/personas/builtinTemplates';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';

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

  const personaId = selectedPersona?.id || '';

  const sampleInput = useMemo(() => {
    if (!selectedPersona) return '{}';
    const match = BUILTIN_TEMPLATES.find(
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
    setExpandedId(expandedId === executionId ? null : executionId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        History
      </h4>

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
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Duration</div>
            <div className="col-span-3">Started</div>
            <div className="col-span-2">Tokens</div>
            <div className="col-span-3">Error</div>
          </div>

          {/* Rows */}
          {executions.map((execution) => {
            const isExpanded = expandedId === execution.id;

            const chevron = isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
            );

            const statusBadge = (
              <span className={`px-2 py-0.5 rounded-md text-sm font-medium ${EXECUTION_STATUS_COLORS[execution.status] ? badgeClass(EXECUTION_STATUS_COLORS[execution.status]!) : ''}`}>
                {execution.status}
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
                  className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-background/30 border-b border-primary/10 cursor-pointer hover:bg-secondary/20 transition-colors"
                >
                  <div className="col-span-2 flex items-center gap-2">
                    {chevron}
                    {statusBadge}
                    {retryBadge}
                  </div>
                  <div className="col-span-2 flex items-center">
                    {duration}
                  </div>
                  <div className="col-span-3 text-sm text-foreground/90 flex items-center">
                    {formatTimestamp(execution.started_at)}
                  </div>
                  <div className="col-span-2 text-sm text-foreground/90 font-mono flex items-center">
                    <span title="Input tokens">{formatTokens(execution.input_tokens)}</span>
                    {' / '}
                    <span title="Output tokens">{formatTokens(execution.output_tokens)}</span>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span className="text-sm text-muted-foreground/80 truncate block">
                      {execution.error_message || '-'}
                    </span>
                  </div>
                </motion.div>

                {/* Mobile card layout (<md) */}
                <div
                  onClick={() => handleRowClick(execution.id)}
                  className="flex md:hidden flex-col gap-1.5 px-4 py-3 bg-background/30 border-b border-primary/10 cursor-pointer hover:bg-secondary/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
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
                      {execution.error_message}
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
                              {execution.input_data}
                            </pre>
                          </div>
                        )}
                        {execution.error_message && (
                          <div>
                            <span className="text-red-400/70 text-sm font-mono uppercase">Error</span>
                            <p className="mt-1 text-sm text-red-400/80">{execution.error_message}</p>
                          </div>
                        )}
                        {/* Re-run button */}
                        <div className="pt-1">
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
