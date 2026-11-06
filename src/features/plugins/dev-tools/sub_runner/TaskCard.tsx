import { memo, useState } from 'react';
import {
  ChevronDown, ChevronRight,
  AlertTriangle, Target, RotateCcw, GitBranch, XCircle,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { useSystemStore } from '@/stores/systemStore';
import { openGoalsBoard } from '@/features/companions/athena/guidance/appActions';
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

const STATE_OF: Record<TaskStatus, StateMarkState> = {
  queued: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'error',
  cancelled: 'refused',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <StateMark state={STATE_OF[status]} label={tokenLabel(t, 'execution', status)} />;
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
      className="inline-flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-interactive border border-hair-2 text-ink-2"
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
      className={`animate-fade-slide-in border rounded-card overflow-hidden transition-colors ${
        hasWarnings ? 'border-status-warning/40' : 'border-hair hover:border-hair-2'
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
                className="inline-flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-interactive border border-status-warning/40 text-status-warning"
                title={contextWarnings.join('\n')}
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {t.plugins.dev_tools.partial_context}
              </span>
            )}
            {task.depth && task.depth !== 'quick' && (
              <span className="typo-eyebrow text-ink-3">
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
                    <span className="typo-caption text-ink-3 shrink-0">{t.plugins.dev_runner.source_label}</span>
                    {sourceAgentEmoji && <span className="typo-caption shrink-0">{sourceAgentEmoji}</span>}
                    <span
                      className="typo-caption text-ink-2 truncate max-w-[220px]"
                      title={sourceIdea.description ?? sourceIdea.title}
                    >
                      {sourceIdea.title}
                    </span>
                    <ValueBadge idea={{ impact: sourceIdea.impact ?? 5, effort: sourceIdea.effort ?? 5, risk: sourceIdea.risk ?? 5 }} />
                  </span>
                ) : (
                  <p className="typo-caption text-ink-3">{t.plugins.dev_runner.source_label} {task.source_idea_id}</p>
                )
              )}
              {goal && (
                <button
                  type="button"
                  onClick={openGoalsBoard}
                  title={t.plugins.dev_runner.goal_pill_tooltip}
                  className="inline-flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-interactive border border-hair-2 text-ink-2 hover:border-primary hover:text-ink-1 transition-colors max-w-[200px]"
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
            <div className="w-24 h-1.5 bg-surface-2 overflow-hidden">
              <div
                className={`animate-fade-in h-full ${status === 'completed' ? 'bg-status-success' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <span className="typo-data text-ink-2 w-8 text-right">
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
          <p className="typo-code text-ink-3 truncate">
            {outputLines[outputLines.length - 1]}
          </p>
        </div>
      )}

      {/* Terminal error */}
      {task.error && status === 'failed' && (
        <div className="mx-4 mb-2 rounded-card border border-status-error/40 px-3 py-2">
          <p className="typo-code text-status-error line-clamp-3">{task.error}</p>
        </div>
      )}

      {/* Context warnings banner */}
      {hasWarnings && expanded && (
        <div className="mx-4 mb-2 rounded-card border border-status-warning/40 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-status-warning" />
            <span className="typo-caption text-status-warning">{t.plugins.dev_tools.context_warnings_title}</span>
          </div>
          <ul className="space-y-0.5">
            {contextWarnings.map((w, i) => (
              <li key={i} className="typo-code text-ink-2">{w}</li>
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
