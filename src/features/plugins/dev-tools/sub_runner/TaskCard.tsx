import { memo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle, Clock, Ban,
  AlertTriangle, Target, RotateCcw, GitBranch, XCircle,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { openGoalsBoard } from '@/features/plugins/companion/guidance/appActions';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { SCAN_AGENTS } from '../constants/scanAgents';
import { ValueBadge } from '../constants/ideaBadges';
import { TaskOutputPanel } from './TaskOutputPanel';
import { PrBridge } from './PrBridge';
import { normalizeStatus, type TaskStatus } from './useTaskQueue';
import type { DevTask } from '@/lib/bindings/DevTask';

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Clock; className: string; pulse?: boolean }> = {
  queued: { icon: Clock, className: 'bg-primary/10 text-foreground border-primary/15' },
  running: { icon: Loader2, className: 'bg-blue-500/15 text-blue-400 border-blue-500/25', pulse: true },
  completed: { icon: CheckCircle2, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  failed: { icon: AlertCircle, className: 'bg-red-500/15 text-red-400 border-red-500/25' },
  cancelled: { icon: Ban, className: 'bg-primary/10 text-foreground border-primary/10' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 typo-caption font-medium border ${cfg.className}`}>
      <Icon className={`w-3 h-3 ${cfg.pulse ? 'animate-spin' : ''}`} />
      {tokenLabel(t, 'execution', status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Retry lineage
// ---------------------------------------------------------------------------

/**
 * Retry lineage pill — `parent_task_id` + `attempt` replaced the old
 * `[Retry] ` title mutation, so a re-attempt now shows its depth (and, when
 * the parent happens to be in the loaded window, what it re-ran) instead of
 * accumulating prefixes in the title.
 */
function RetryLineageChip({ attempt, parentTitle }: { attempt: number; parentTitle?: string | null }) {
  const { t, tx } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border text-sky-400 border-sky-500/25 bg-sky-500/10"
      title={parentTitle ? tx(t.plugins.dev_runner.retry_of, { title: parentTitle }) : undefined}
    >
      <GitBranch className="w-2.5 h-2.5" />
      {tx(t.plugins.dev_runner.attempt_chip, { attempt })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

// Stable fallback so the per-card buffer selector returns a referentially
// stable value when a task has no output yet (`?? []` would create a fresh
// array per store snapshot and defeat Zustand's Object.is bail-out).
const EMPTY_LINES: string[] = [];

export interface TaskCardProps {
  task: DevTask;
  /** Session-only warnings from `TASK_EXEC_COMPLETE` (no durable column). */
  contextWarnings?: string[];
  /** Title of `parent_task_id` when that row is in the loaded window. */
  parentTitle?: string | null;
  onRetry: (task: DevTask) => void;
  onCancel: (task: DevTask) => void;
}

/**
 * Memoized: during streaming only `taskOutputBuffers` changes in the store,
 * and each card subscribes to its own buffer below — so a streamed line
 * re-renders only the card it belongs to, not the whole queue.
 *
 * The fake `progressToPhase` mapping the old runner rendered (a phase name
 * invented from the progress number) is gone: the card shows the real
 * progress %, the real status, and the last streamed output line.
 */
export const TaskCard = memo(function TaskCard({
  task,
  contextWarnings,
  parentTitle,
  onRetry,
  onCancel,
}: TaskCardProps) {
  const { t } = useTranslation();
  const outputLines = useSystemStore((s) => s.taskOutputBuffers[task.id] ?? EMPTY_LINES);
  const [expanded, setExpanded] = useState(false);

  const status = normalizeStatus(task.status);
  const progress = task.progress_pct ?? 0;
  const hasOutput = outputLines.length > 0;
  const hasWarnings = !!contextWarnings && contextWarnings.length > 0;

  const goal = useSystemStore((s) => (task.goal_id ? s.goals.find((g) => g.id === task.goal_id) ?? null : null));
  // Resolve the source idea so the card shows what the task came from
  // (title + value + agent) instead of an opaque id.
  const sourceIdea = useSystemStore((s) =>
    task.source_idea_id ? s.ideas.find((i) => i.id === task.source_idea_id) ?? null : null,
  );
  const sourceAgentEmoji = sourceIdea
    ? SCAN_AGENTS.find((a) => a.key === sourceIdea.scan_type)?.emoji ?? null
    : null;

  return (
    <div
      data-task-id={task.id}
      className={`animate-fade-slide-in border rounded-modal overflow-hidden transition-colors ${
        hasWarnings ? 'border-amber-500/25 hover:border-amber-500/35' : 'border-primary/10 hover:border-primary/20'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusBadge status={status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="typo-card-label truncate">{task.title}</h4>
            {task.parent_task_id && (
              <RetryLineageChip attempt={task.attempt} parentTitle={parentTitle} />
            )}
            {hasWarnings && (
              <span
                className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border text-amber-400 border-amber-500/25 bg-amber-500/10"
                title={contextWarnings.join('\n')}
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {t.plugins.dev_tools.partial_context}
              </span>
            )}
            {task.depth && task.depth !== 'quick' && (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                task.depth === 'campaign'
                  ? 'text-amber-400 border-amber-500/25 bg-amber-500/10'
                  : 'text-violet-400 border-violet-500/25 bg-violet-500/10'
              }`}>
                {task.depth === 'campaign'
                  ? t.plugins.dev_runner.depth_campaign_label
                  : t.plugins.dev_runner.depth_deep_build_label}
              </span>
            )}
          </div>
          {(task.source_idea_id || goal) && (
            <div className="flex items-center gap-2 mt-0.5">
              {task.source_idea_id && (
                sourceIdea ? (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] text-foreground shrink-0">{t.plugins.dev_runner.source_label}</span>
                    {sourceAgentEmoji && <span className="text-[10px] shrink-0">{sourceAgentEmoji}</span>}
                    <span
                      className="text-[10px] text-foreground font-medium truncate max-w-[220px]"
                      title={sourceIdea.description ?? sourceIdea.title}
                    >
                      {sourceIdea.title}
                    </span>
                    <ValueBadge idea={{ impact: sourceIdea.impact ?? 5, effort: sourceIdea.effort ?? 5, risk: sourceIdea.risk ?? 5 }} />
                  </span>
                ) : (
                  <p className="text-[10px] text-foreground">{t.plugins.dev_runner.source_label} {task.source_idea_id}</p>
                )
              )}
              {goal && (
                <button
                  type="button"
                  onClick={openGoalsBoard}
                  title={t.plugins.dev_runner.goal_pill_tooltip}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/40 transition-colors max-w-[200px]"
                >
                  <Target className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{goal.title}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Real progress — no invented phase names */}
        {(status === 'running' || status === 'completed') && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-24 h-1.5 bg-primary/10 rounded-full overflow-hidden">
              <div
                className={`animate-fade-in h-full rounded-full ${status === 'completed' ? 'bg-emerald-400' : 'bg-blue-400'}`}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <span className="text-[10px] text-foreground w-8 text-right tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {(status === 'failed' || status === 'cancelled') && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => onRetry(task)}
            >
              {t.common.retry}
            </Button>
          )}
          {(status === 'running' || status === 'queued') && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t.plugins.dev_runner.cancel_task}
              onClick={() => onCancel(task)}
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          )}
          {hasOutput && (
            <Button variant="ghost" size="icon-sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Last streamed line (collapsed) */}
      {!expanded && hasOutput && (
        <div className="px-4 pb-2 -mt-1">
          <p className="text-[10px] text-foreground truncate leading-relaxed font-mono">
            {outputLines[outputLines.length - 1]}
          </p>
        </div>
      )}

      {/* Terminal error */}
      {task.error && status === 'failed' && (
        <div className="mx-4 mb-2 rounded-card border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-[10px] text-red-300/80 font-mono line-clamp-3">{task.error}</p>
        </div>
      )}

      {/* Context warnings banner */}
      {hasWarnings && expanded && (
        <div className="mx-4 mb-2 rounded-card border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-medium text-amber-400">{t.plugins.dev_tools.context_warnings_title}</span>
          </div>
          <ul className="space-y-0.5">
            {contextWarnings.map((w, i) => (
              <li key={i} className="text-[10px] text-amber-300/70 font-mono">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expanded output */}
      {expanded && hasOutput && (
        <div className="animate-fade-slide-in overflow-hidden">
          <div className="px-4 pb-3 pt-0">
            <TaskOutputPanel taskId={task.id} lines={outputLines} isRunning={status === 'running'} />
          </div>
        </div>
      )}

      {/* Draft PR bridge — self-gates on status === 'completed' */}
      <PrBridge task={task} />
    </div>
  );
});
