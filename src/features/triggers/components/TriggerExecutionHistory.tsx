import { useState, useEffect } from 'react';
import {
  History, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  RefreshCw, RotateCcw, CheckCircle2, XCircle, TrendingDown,
  Clock, Activity, BarChart3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { TriggerHistoryStats } from '../hooks/useTriggerHistory';
import { useTriggerHistory } from '../hooks/useTriggerHistory';

// ─── Stats Bar ──────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: TriggerHistoryStats }) {
  if (stats.totalRuns === 0) return null;

  const rateColor = stats.successRate >= 90
    ? 'text-emerald-400'
    : stats.successRate >= 70
      ? 'text-amber-400'
      : 'text-red-400';

  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg bg-background/30 border border-primary/5 text-sm">
      <div className="flex items-center gap-1 text-muted-foreground/80">
        <BarChart3 className="w-3 h-3" />
        <span>{stats.totalRuns} runs</span>
      </div>
      <div className={`flex items-center gap-1 ${rateColor}`}>
        <Activity className="w-3 h-3" />
        <span>{stats.successRate}%</span>
      </div>
      {stats.avgDurationMs > 0 && (
        <div className="flex items-center gap-1 text-muted-foreground/70">
          <Clock className="w-3 h-3" />
          <span>avg {formatDuration(stats.avgDurationMs)}</span>
        </div>
      )}
      {stats.recentFailures >= 3 && (
        <div className="flex items-center gap-1 text-red-400/80 ml-auto">
          <TrendingDown className="w-3 h-3" />
          <span>{stats.recentFailures}/5 recent failed</span>
        </div>
      )}
    </div>
  );
}

// ─── Payload Inspector ──────────────────────────────────────────────

function PayloadBlock({ label, data }: { label: string; data: string | null }) {
  if (!data) return null;

  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-muted-foreground/70 uppercase tracking-wide">{label}</div>
      <pre className="px-2.5 py-2 rounded-lg bg-background/40 border border-primary/5 text-sm font-mono text-foreground/80 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
        {formatted}
      </pre>
    </div>
  );
}

// ─── Execution Row ──────────────────────────────────────────────────

interface ExecutionRowProps {
  exec: PersonaExecution;
  isExpanded: boolean;
  onToggle: () => void;
  onReplay: () => void;
  isReplaying: boolean;
  replayResult: { success: boolean; message: string } | null;
}

function ExecutionRow({ exec, isExpanded, onToggle, onReplay, isReplaying, replayResult }: ExecutionRowProps) {
  const statusEntry = getStatusEntry(exec.status);
  const StatusIcon = statusEntry.icon;
  const hasPayload = exec.input_data || exec.output_data || exec.error_message;

  return (
    <div className="rounded-xl bg-background/30 border border-primary/5 overflow-hidden">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-secondary/20 transition-colors"
      >
        {hasPayload ? (
          isExpanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
        ) : (
          <div className="w-3 h-3 flex-shrink-0" />
        )}
        <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusEntry.text} ${statusEntry.pulse ? 'animate-pulse' : ''}`} />
        <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${badgeClass(statusEntry)}`}>
          {statusEntry.label}
        </span>
        <span className="text-muted-foreground/90 font-mono">
          {formatDuration(exec.duration_ms)}
        </span>
        {exec.retry_count > 0 && (
          <span className="text-amber-400/70 text-sm">retry #{exec.retry_count}</span>
        )}
        <span className="text-muted-foreground/60 ml-auto text-sm">
          {formatRelativeTime(exec.started_at)}
        </span>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 space-y-2 border-t border-primary/5">
              {/* Metadata line */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground/60">
                <span className="font-mono">{exec.id.slice(0, 12)}</span>
                {exec.model_used && <span>model: {exec.model_used}</span>}
                {(exec.input_tokens > 0 || exec.output_tokens > 0) && (
                  <span>{exec.input_tokens}→{exec.output_tokens} tokens</span>
                )}
                {exec.cost_usd > 0 && <span>${exec.cost_usd.toFixed(4)}</span>}
              </div>

              {/* Payloads */}
              <PayloadBlock label="Input" data={exec.input_data} />
              <PayloadBlock label="Output" data={exec.output_data} />
              {exec.error_message && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-red-400/70 uppercase tracking-wide">Error</div>
                  <div className="px-2.5 py-2 rounded-lg bg-red-500/5 border border-red-500/10 text-sm text-red-400/90 font-mono whitespace-pre-wrap break-all">
                    {exec.error_message}
                  </div>
                </div>
              )}

              {/* Replay + result */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onReplay(); }}
                  disabled={isReplaying}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-cyan-400/80 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg border border-cyan-500/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Re-fire with the same input payload"
                >
                  {isReplaying
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />}
                  {isReplaying ? 'Replaying...' : 'Replay'}
                </button>
                {replayResult && (
                  <span className={`flex items-center gap-1 text-sm ${replayResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {replayResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {replayResult.message}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

interface TriggerExecutionHistoryProps {
  triggerId: string;
  personaId: string;
  /** Whether the section starts open (replaces the old activityOpen toggle) */
  defaultOpen?: boolean;
}

export function TriggerExecutionHistory({ triggerId, personaId, defaultOpen = false }: TriggerExecutionHistoryProps) {
  const history = useTriggerHistory(triggerId, personaId);
  const [open, setOpen] = useState(defaultOpen);

  // Auto-fetch on first open
  useEffect(() => {
    if (open && history.executions.length === 0 && !history.loading) {
      void history.fetch();
    }
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 pt-1 border-t border-primary/5 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors w-full"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <History className="w-3 h-3" />
        Execution history
        {history.stats.totalRuns > 0 && (
          <span className="text-muted-foreground/50 ml-1">({history.stats.totalRuns})</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 pt-1">
              {history.loading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground/80">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </div>
              ) : history.error ? (
                <div className="flex items-center gap-2 py-2 text-sm text-amber-400/90">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Could not load history
                  <button
                    onClick={() => void history.fetch()}
                    className="ml-auto flex items-center gap-1 text-sm text-muted-foreground/80 hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                </div>
              ) : history.executions.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground/80">
                  No executions recorded for this trigger yet
                </div>
              ) : (
                <>
                  <StatsBar stats={history.stats} />
                  {history.executions.map((exec) => (
                    <ExecutionRow
                      key={exec.id}
                      exec={exec}
                      isExpanded={history.expandedId === exec.id}
                      onToggle={() => history.toggleExpanded(exec.id)}
                      onReplay={() => void history.replay(exec)}
                      isReplaying={history.replaying === exec.id}
                      replayResult={history.replayResult?.id === exec.id ? history.replayResult : null}
                    />
                  ))}
                  {/* Refresh button */}
                  <button
                    onClick={() => void history.fetch()}
                    disabled={history.loading}
                    className="flex items-center gap-1.5 w-full justify-center py-1.5 text-sm text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${history.loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

