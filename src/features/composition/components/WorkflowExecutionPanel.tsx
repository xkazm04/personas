import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, AlertTriangle, Loader2, Clock, X, DollarSign, Zap } from 'lucide-react';
import type { WorkflowExecution, WorkflowNode, WorkflowNodeExecution } from '@/lib/types/compositionTypes';
import { formatDuration, formatCost as _formatCost } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

const formatCost = (usd: number | undefined) => _formatCost(usd, { precision: 'auto' });

function formatTokens(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface WorkflowExecutionPanelProps {
  execution: WorkflowExecution;
  nodes: WorkflowNode[];
}

const statusIcon: Record<string, typeof Check> = {
  completed: Check,
  failed: AlertTriangle,
  running: Loader2,
  pending: Clock,
  queued: Clock,
  skipped: X,
};

const statusColor: Record<string, string> = {
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  running: 'text-cyan-400 animate-spin',
  pending: 'text-muted-foreground/50',
  queued: 'text-amber-400',
  skipped: 'text-muted-foreground/40',
};

function NodeExecutionRow({ nodeExec, node }: { nodeExec: WorkflowNodeExecution; node?: WorkflowNode }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const Icon = statusIcon[nodeExec.status] ?? Clock;
  const color = statusColor[nodeExec.status] ?? 'text-muted-foreground';
  const hasMetrics = nodeExec.cost_usd != null || nodeExec.input_tokens != null;
  const hasDetails = nodeExec.output || nodeExec.error || hasMetrics;

  return (
    <div className="border border-primary/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors text-left"
      >
        <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {node?.label ?? nodeExec.nodeId}
        </span>
        {nodeExec.duration_ms != null && (
          <span className="text-[10px] font-mono text-muted-foreground/60">
            {formatDuration(nodeExec.duration_ms)}
          </span>
        )}
        {nodeExec.cost_usd != null && (
          <span className="text-[10px] font-mono text-amber-400/70">
            {formatCost(nodeExec.cost_usd)}
          </span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
          {nodeExec.status}
        </span>
        {hasDetails && (
          expanded
            ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
            : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="px-3 py-2 border-t border-primary/10 bg-secondary/10 space-y-1.5">
          {/* Metrics row */}
          {hasMetrics && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground/70">
              {nodeExec.execution_ms != null && (
                <span title={t.composition.tooltip_exec_time}>exec {formatDuration(nodeExec.execution_ms)}</span>
              )}
              {nodeExec.poll_overhead_ms != null && (
                <span title={t.composition.tooltip_poll_overhead}>poll {formatDuration(nodeExec.poll_overhead_ms)}</span>
              )}
              {nodeExec.input_tokens != null && (
                <span title={t.composition.tooltip_input_tokens}>in {formatTokens(nodeExec.input_tokens)}</span>
              )}
              {nodeExec.output_tokens != null && (
                <span title={t.composition.tooltip_output_tokens}>out {formatTokens(nodeExec.output_tokens)}</span>
              )}
            </div>
          )}
          {nodeExec.error && (
            <div className="text-xs text-red-400 font-mono">{nodeExec.error}</div>
          )}
          {nodeExec.output && (
            <pre className="text-xs text-foreground/70 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
              {nodeExec.output.length > 2000
                ? nodeExec.output.slice(0, 2000) + `\n${t.composition.truncated}`
                : nodeExec.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkflowExecutionPanel({ execution, nodes }: WorkflowExecutionPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const totalNodes = Object.keys(execution.nodeExecutions).length;
  const completedNodes = Object.values(execution.nodeExecutions).filter(
    (ne) => ne.status === 'completed',
  ).length;

  const overallColor =
    execution.status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/5' :
    execution.status === 'failed' ? 'border-red-500/30 bg-red-500/5' :
    execution.status === 'running' ? 'border-cyan-500/30 bg-cyan-500/5' :
    'border-primary/15 bg-secondary/20';

  return (
    <div className={`absolute bottom-4 right-4 w-80 rounded-xl border shadow-elevation-3 backdrop-blur-md ${overallColor} z-20`}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-foreground flex-1">
          {execution.status === 'running' ? t.composition.workflow_running : execution.status === 'completed' ? t.composition.workflow_complete : execution.status === 'failed' ? t.composition.workflow_failed : execution.status}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {completedNodes}/{totalNodes}
        </span>
        {collapsed ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {/* Totals row */}
      {(execution.total_duration_ms != null || execution.total_cost_usd != null) && (
        <div className="px-4 pb-1 flex items-center gap-3 text-[10px] font-mono text-muted-foreground/70">
          {execution.total_duration_ms != null && (
            <span className="flex items-center gap-0.5" title={t.composition.tooltip_wall_clock}>
              <Clock className="w-2.5 h-2.5" /> {formatDuration(execution.total_duration_ms)}
            </span>
          )}
          {execution.total_cost_usd != null && (
            <span className="flex items-center gap-0.5 text-amber-400/70" title={t.composition.tooltip_llm_cost}>
              <DollarSign className="w-2.5 h-2.5" /> {formatCost(execution.total_cost_usd)}
            </span>
          )}
          {(execution.total_input_tokens != null || execution.total_output_tokens != null) && (
            <span className="flex items-center gap-0.5" title={t.composition.tooltip_total_tokens}>
              <Zap className="w-2.5 h-2.5" /> {formatTokens(execution.total_input_tokens)}/{formatTokens(execution.total_output_tokens)}
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="px-4 pb-2">
        <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              execution.status === 'failed' ? 'bg-red-500' :
              execution.status === 'completed' ? 'bg-emerald-500' :
              'bg-cyan-500'
            }`}
            style={{ width: `${totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Node list */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-60 overflow-y-auto">
          {Object.values(execution.nodeExecutions).map((ne) => (
            <NodeExecutionRow
              key={ne.nodeId}
              nodeExec={ne}
              node={nodeMap.get(ne.nodeId)}
            />
          ))}

          {/* Final output */}
          {execution.output && execution.status === 'completed' && (
            <div className="mt-2 border border-emerald-500/20 rounded-lg px-3 py-2 bg-emerald-500/5">
              <div className="text-[10px] font-semibold text-emerald-400 uppercase mb-1">{t.composition.final_output}</div>
              <pre className="text-xs text-foreground/70 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                {execution.output.length > 1000
                  ? execution.output.slice(0, 1000) + `\n${t.composition.truncated}`
                  : execution.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
