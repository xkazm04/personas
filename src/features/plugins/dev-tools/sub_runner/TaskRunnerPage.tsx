import { useState, useCallback, useEffect } from 'react';
import {
  Play, Plus, ListChecks, XCircle, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, AlertCircle, Clock, Ban, X, Link2,
  Zap, Layers, Building2,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { TaskOutputPanel } from './TaskOutputPanel';
import { SelfHealingPanel } from './SelfHealingPanel';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type TaskPhase = 'analyzing' | 'planning' | 'implementing' | 'validating' | 'complete';

interface RunnerTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  phase: TaskPhase;
  progress: number;
  source?: string;
  goalId?: string;
  output?: string;
  createdAt: string;
  depth: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progressToPhase(progress: number, status: TaskStatus): TaskPhase {
  if (status === 'completed') return 'complete';
  if (progress < 15) return 'analyzing';
  if (progress < 30) return 'planning';
  if (progress < 60) return 'implementing';
  if (progress < 85) return 'validating';
  return 'complete';
}

// ---------------------------------------------------------------------------
// Status + Phase styling
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Clock; label: string; className: string; pulse?: boolean }> = {
  queued: { icon: Clock, label: 'Queued', className: 'bg-primary/10 text-muted-foreground border-primary/15' },
  running: { icon: Loader2, label: 'Running', className: 'bg-blue-500/15 text-blue-400 border-blue-500/25', pulse: true },
  completed: { icon: CheckCircle2, label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  failed: { icon: AlertCircle, label: 'Failed', className: 'bg-red-500/15 text-red-400 border-red-500/25' },
  cancelled: { icon: Ban, label: 'Cancelled', className: 'bg-primary/10 text-muted-foreground/50 border-primary/10' },
};

const PHASE_CONFIG: Record<TaskPhase, { label: string; color: string; range: [number, number] }> = {
  analyzing: { label: 'Analyzing', color: 'bg-blue-400', range: [0, 15] },
  planning: { label: 'Planning', color: 'bg-indigo-400', range: [15, 30] },
  implementing: { label: 'Implementing', color: 'bg-violet-400', range: [30, 60] },
  validating: { label: 'Validating', color: 'bg-amber-400', range: [60, 85] },
  complete: { label: 'Complete', color: 'bg-emerald-400', range: [85, 100] },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${cfg.className}`}>
      <Icon className={`w-3 h-3 ${cfg.pulse ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Task Creation Modal
// ---------------------------------------------------------------------------

const DEPTH_OPTIONS = [
  { value: 'quick', label: 'Quick', icon: Zap, description: 'Execute directly, minimal planning', color: 'emerald' },
  { value: 'campaign', label: 'Campaign', icon: Layers, description: 'Break into subtasks, multiple deliverables', color: 'amber' },
  { value: 'deep_build', label: 'Deep Build', icon: Building2, description: 'Full research, planning, and implementation', color: 'violet' },
] as const;

function TaskModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { title: string; description: string; goalId?: string; depth?: string }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalId, setGoalId] = useState('');
  const [depth, setDepth] = useState<string>('quick');
  const { shouldAnimate: _shouldAnimate } = useMotion();

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim(), goalId: goalId.trim() || undefined, depth });
    setTitle('');
    setDescription('');
    setGoalId('');
    setDepth('quick');
    onClose();
  };

  if (!open) return null;

  return (
    <div
        className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="animate-fade-slide-in bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-elevation-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-foreground/90">{t.plugins.dev_tools.new_task}</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this task should accomplish..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30 resize-none"
              />
            </div>

            {/* Task depth selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Task Depth</label>
              <div className="grid grid-cols-3 gap-2">
                {DEPTH_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = depth === opt.value;
                  const ring = selected ? `ring-2 ring-${opt.color}-500/40 border-${opt.color}-500/40` : 'border-primary/10 hover:border-primary/20';
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border bg-secondary/30 transition-all ${ring}`}
                    >
                      <Icon className={`w-4 h-4 ${selected ? `text-${opt.color}-400` : 'text-muted-foreground/60'}`} />
                      <span className={`text-xs font-medium ${selected ? 'text-foreground' : 'text-muted-foreground/70'}`}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                {DEPTH_OPTIONS.find((o) => o.value === depth)?.description}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Goal Link <span className="text-muted-foreground/40">(optional)</span>
              </label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                <input
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                  placeholder="Goal ID or name..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!title.trim()}
              onClick={handleSubmit}
            >
              Create Task
            </Button>
          </div>
        </div>
      </div>
  );
}

// ---------------------------------------------------------------------------
// Task Card
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  index: _index,
  outputLines,
}: {
  task: RunnerTask;
  index: number;
  outputLines: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { staggerDelay: _staggerDelay } = useMotion();
  const phaseCfg = PHASE_CONFIG[task.phase];
  const hasOutput = outputLines.length > 0 || task.output;

  return (
    <div
      className="animate-fade-slide-in border border-primary/10 rounded-xl overflow-hidden hover:border-primary/20 transition-colors"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusBadge status={task.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground/80 truncate">{task.title}</h4>
            {task.depth && task.depth !== 'quick' && (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                task.depth === 'campaign'
                  ? 'text-amber-400 border-amber-500/25 bg-amber-500/10'
                  : 'text-violet-400 border-violet-500/25 bg-violet-500/10'
              }`}>
                {task.depth === 'campaign' ? 'Campaign' : 'Deep Build'}
              </span>
            )}
          </div>
          {task.source && (
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">Source: {task.source}</p>
          )}
        </div>

        {/* Phase + progress */}
        {(task.status === 'running' || task.status === 'completed') && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground/50 font-medium">
              {phaseCfg.label}
            </span>
            <div className="w-24 h-1.5 bg-primary/10 rounded-full overflow-hidden">
              <div
                className={`animate-fade-in h-full ${phaseCfg.color} rounded-full`} style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground/40 w-8 text-right">
              {Math.round(task.progress)}%
            </span>
          </div>
        )}

        {/* Expand button for output */}
        {hasOutput && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>

      {/* Last-exchange preview (collapsed) */}
      {!expanded && outputLines.length > 0 && (
        <div className="px-4 pb-2 -mt-1">
          <p className="text-[10px] text-foreground/50 truncate leading-relaxed font-mono">
            {outputLines[outputLines.length - 1]}
          </p>
        </div>
      )}

      {/* Expanded output */}
      {expanded && hasOutput && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0">
              {outputLines.length > 0 ? (
                <TaskOutputPanel
                  taskId={task.id}
                  lines={outputLines}
                  isRunning={task.status === 'running'}
                />
              ) : task.output ? (
                <pre className="text-[11px] text-muted-foreground/60 bg-primary/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                  {task.output}
                </pre>
              ) : null}
            </div>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TaskRunnerPage() {
  const { t } = useTranslation();
  const { createTask, batchFromAcceptedIdeas: batchFromAccepted, startBatch, cancelAllTasks: cancelAll } = useDevToolsActions();

  const storeTasks = useSystemStore((s) => s.tasks);
  const fetchTasks = useSystemStore((s) => s.fetchTasks);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const taskOutputBuffers = useSystemStore((s) => s.taskOutputBuffers);
  const appendTaskOutput = useSystemStore((s) => s.appendTaskOutput);

  const [showModal, setShowModal] = useState(false);

  // Map DevTask to RunnerTask view model
  const tasks: RunnerTask[] = storeTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    status: (t.status as TaskStatus) || 'queued',
    phase: progressToPhase(t.progress_pct ?? 0, (t.status as TaskStatus) || 'queued'),
    progress: t.progress_pct ?? 0,
    source: t.source_idea_id ?? undefined,
    goalId: t.goal_id ?? undefined,
    output: undefined,
    createdAt: t.created_at,
    depth: t.depth ?? 'quick',
  }));

  // Fetch tasks on mount and when project changes
  useEffect(() => {
    if (activeProjectId) {
      fetchTasks(activeProjectId);
    }
  }, [activeProjectId, fetchTasks]);

  // Event listeners for task execution streaming
  useEffect(() => {
    const outputUn = listen<{ job_id: string; line: string }>(EventName.TASK_EXEC_OUTPUT, (event) => {
      const { job_id, line } = event.payload;
      appendTaskOutput(job_id, line);
    });

    const statusUn = listen<{ job_id: string; status: string; error?: string }>(EventName.TASK_EXEC_STATUS, (event) => {
      const { job_id: _job_id, status: _status } = event.payload;
      // Refetch tasks to get updated status
      if (activeProjectId) fetchTasks(activeProjectId);
    });

    const completeUn = listen<{ task_id: string; output_lines: number }>(EventName.TASK_EXEC_COMPLETE, () => {
      // Refetch tasks to get final state
      if (activeProjectId) fetchTasks(activeProjectId);
      // End process in activity drawer if no more running tasks
      setTimeout(() => {
        const store = useSystemStore.getState();
        const stillRunning = store.tasks.some((t) => t.status === 'running');
        if (!stillRunning) useOverviewStore.getState().processEnded('task_runner', 'completed');
      }, 500);
    });

    return () => {
      outputUn.then(fn => fn());
      statusUn.then(fn => fn());
      completeUn.then(fn => fn());
    };
  }, [activeProjectId, fetchTasks, appendTaskOutput]);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const totalCount = tasks.length;

  const overallProgress = totalCount > 0
    ? tasks.reduce((acc, t) => acc + t.progress, 0) / totalCount
    : 0;

  const handleCreateTask = useCallback((data: { title: string; description: string; goalId?: string; depth?: string }) => {
    createTask(data);
  }, [createTask]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Play className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.task_runner_title}
        subtitle={t.plugins.dev_tools.task_runner_subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowModal(true)}
            >
              New Task
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ListChecks className="w-3.5 h-3.5" />}
              onClick={() => batchFromAccepted()}
            >
              Batch from Accepted
            </Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              disabled={queuedCount === 0 && runningCount === 0}
              onClick={() => { startBatch(); useOverviewStore.getState().processStarted('task_runner', undefined, 'Task Runner Batch'); }}
            >
              Start Batch
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<XCircle className="w-3.5 h-3.5" />}
              disabled={runningCount === 0 && queuedCount === 0}
              onClick={() => cancelAll()}
            >
              Cancel All
            </Button>
          </div>
        }
      />

      <ContentBody>
        <div className="space-y-5">
          {/* Batch progress header */}
          {totalCount > 0 && (
            <div className="border border-primary/10 rounded-xl p-4 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-foreground/80">Batch Progress</h3>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                  {runningCount > 0 && (
                    <span className="flex items-center gap-1 text-blue-400">
                      <LoadingSpinner size="xs" /> {runningCount} running
                    </span>
                  )}
                  {queuedCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {queuedCount} queued
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> {completedCount} done
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle className="w-3 h-3" /> {failedCount} failed
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full h-2 bg-primary/10 rounded-full overflow-hidden">
                <div
                  className="animate-fade-in h-full bg-amber-400 rounded-full" style={{ width: `${overallProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
                {Math.round(overallProgress)}% overall
              </p>
            </div>
          )}

          {/* Self-healing panel */}
          <SelfHealingPanel onRetryTask={async (taskId) => {
            // Re-create the failed task and queue it for retry
            const task = tasks.find((t) => t.id === taskId);
            if (task) {
              try {
                await createTask({ title: `[Retry] ${task.title}`, description: task.description, goalId: task.goalId });
              } catch { /* ignore */ }
            }
          }} />

          {/* Task queue */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
              Task Queue ({totalCount})
            </h3>

            {tasks.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-primary/10 rounded-xl">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Play className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-sm text-muted-foreground/60 mb-1">No tasks in queue</p>
                <p className="text-xs text-muted-foreground/40 mb-4">
                  Create tasks manually or batch from accepted ideas
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => setShowModal(true)}
                  >
                    New Task
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<ListChecks className="w-3.5 h-3.5" />}
                    onClick={() => batchFromAccepted()}
                  >
                    Batch from Accepted
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    index={i}
                    outputLines={taskOutputBuffers[task.id] ?? []}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <TaskModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreateTask}
      />
    </ContentBox>
  );
}
