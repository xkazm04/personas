import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Play, Plus, ListChecks, XCircle, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, AlertCircle, Clock, Ban, X, Link2,
  Zap, Layers, Building2, AlertTriangle, Infinity as InfinityIcon,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { TaskOutputPanel } from './TaskOutputPanel';
import { SelfHealingPanel } from './SelfHealingPanel';
import { PrBridge } from './PrBridge';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch } from '@/lib/silentCatch';
import { startAutoRun, cancelAutoRun } from '@/api/devTools/devTools';
import type { DevTask } from '@/lib/bindings/DevTask';

interface AutoRunState {
  runId: string;
  snapshotSize: number;
  status: 'running' | 'cancelled' | 'completed';
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    iterations: number;
    terminationReason: string;
  };
}

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
  contextWarnings?: string[];
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

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Clock; className: string; pulse?: boolean }> = {
  queued: { icon: Clock, className: 'bg-primary/10 text-foreground border-primary/15' },
  running: { icon: Loader2, className: 'bg-blue-500/15 text-blue-400 border-blue-500/25', pulse: true },
  completed: { icon: CheckCircle2, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  failed: { icon: AlertCircle, className: 'bg-red-500/15 text-red-400 border-red-500/25' },
  cancelled: { icon: Ban, className: 'bg-primary/10 text-foreground border-primary/10' },
};

const PHASE_CONFIG: Record<TaskPhase, { color: string; range: [number, number] }> = {
  analyzing: { color: 'bg-blue-400', range: [0, 15] },
  planning: { color: 'bg-indigo-400', range: [15, 30] },
  implementing: { color: 'bg-violet-400', range: [30, 60] },
  validating: { color: 'bg-amber-400', range: [60, 85] },
  complete: { color: 'bg-emerald-400', range: [85, 100] },
};

function StatusBadge({ status }: { status: TaskStatus }) {
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
// Task Creation Modal
// ---------------------------------------------------------------------------

type DepthColor = 'emerald' | 'amber' | 'violet';

// Static class bundles so Tailwind's JIT can detect every class at build time.
// `ring-${color}-500/40` style template strings are invisible to the JIT and
// silently produce no styles, so the depth-selector highlight stayed blank.
const DEPTH_COLOR_CLASSES: Record<DepthColor, { selectedRing: string; selectedIcon: string }> = {
  emerald: { selectedRing: 'ring-2 ring-emerald-500/40 border-emerald-500/40', selectedIcon: 'text-emerald-400' },
  amber:   { selectedRing: 'ring-2 ring-amber-500/40 border-amber-500/40',     selectedIcon: 'text-amber-400'   },
  violet:  { selectedRing: 'ring-2 ring-violet-500/40 border-violet-500/40',   selectedIcon: 'text-violet-400'  },
};

const DEPTH_OPTIONS: { value: string; label: string; icon: typeof Zap; description: string; color: DepthColor }[] = [
  { value: 'quick', label: 'Quick', icon: Zap, description: 'Execute directly, minimal planning', color: 'emerald' },
  { value: 'campaign', label: 'Campaign', icon: Layers, description: 'Break into subtasks, multiple deliverables', color: 'amber' },
  { value: 'deep_build', label: 'Deep Build', icon: Building2, description: 'Full research, planning, and implementation', color: 'violet' },
];

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
            <h2 className="typo-section-title">{t.plugins.dev_tools.new_task}</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 block">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.plugins.dev_runner.task_title_placeholder}
                className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
              />
            </div>
            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.plugins.dev_runner.task_details_placeholder}
                rows={3}
                className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30 resize-none"
              />
            </div>

            {/* Task depth selector */}
            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 block">{t.plugins.dev_runner.task_depth}</label>
              <div className="grid grid-cols-3 gap-2">
                {DEPTH_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const selected = depth === opt.value;
                  const tw = DEPTH_COLOR_CLASSES[opt.color];
                  const ring = selected ? tw.selectedRing : 'border-primary/10 hover:border-primary/20';
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-modal border bg-secondary/30 transition-all ${ring}`}
                    >
                      <Icon className={`w-4 h-4 ${selected ? tw.selectedIcon : 'text-foreground'}`} />
                      <span className="typo-caption font-medium text-foreground">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-foreground mt-1.5">
                {DEPTH_OPTIONS.find((o) => o.value === depth)?.description}
              </p>
            </div>

            <div>
              <label className="typo-caption font-medium text-foreground mb-1.5 block">
                {t.plugins.dev_runner.goal_link} <span className="text-foreground">{t.plugins.dev_runner.optional}</span>
              </label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
                <input
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                  placeholder={t.plugins.dev_runner.goal_link_placeholder}
                  className="w-full pl-9 pr-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/30"
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
              {t.plugins.dev_runner.create_task}
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
  rawTask,
  index: _index,
  outputLines,
}: {
  task: RunnerTask;
  rawTask: DevTask;
  index: number;
  outputLines: string[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { staggerDelay: _staggerDelay } = useMotion();
  const phaseCfg = PHASE_CONFIG[task.phase];
  const hasOutput = outputLines.length > 0 || task.output;
  const hasWarnings = task.contextWarnings && task.contextWarnings.length > 0;

  return (
    <div
      className={`animate-fade-slide-in border rounded-modal overflow-hidden transition-colors ${
        hasWarnings ? 'border-amber-500/25 hover:border-amber-500/35' : 'border-primary/10 hover:border-primary/20'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusBadge status={task.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="typo-card-label truncate">{task.title}</h4>
            {hasWarnings && (
              <span className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border text-amber-400 border-amber-500/25 bg-amber-500/10"
                title={task.contextWarnings!.join('\n')}
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
                {task.depth === 'campaign' ? 'Campaign' : 'Deep Build'}
              </span>
            )}
          </div>
          {task.source && (
            <p className="text-[10px] text-foreground mt-0.5">{t.plugins.dev_runner.source_label} {task.source}</p>
          )}
        </div>

        {/* Phase + progress */}
        {(task.status === 'running' || task.status === 'completed') && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-foreground font-medium">
              {tokenLabel(t, 'task_phase', task.phase)}
            </span>
            <div className="w-24 h-1.5 bg-primary/10 rounded-full overflow-hidden">
              <div
                className={`animate-fade-in h-full ${phaseCfg.color} rounded-full`} style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-foreground w-8 text-right">
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
          <p className="text-[10px] text-foreground truncate leading-relaxed font-mono">
            {outputLines[outputLines.length - 1]}
          </p>
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
            {task.contextWarnings!.map((w, i) => (
              <li key={i} className="text-[10px] text-amber-300/70 font-mono">{w}</li>
            ))}
          </ul>
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
                <pre className="text-[11px] text-foreground bg-primary/5 rounded-card p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                  {task.output}
                </pre>
              ) : null}
            </div>
          </div>
        )}

      {/* Draft PR bridge — only shows itself when status === 'completed' */}
      <PrBridge task={rawTask} />
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

  const [showModal, setShowModal] = useState(false);
  const [taskWarnings, setTaskWarnings] = useState<Record<string, string[]>>({});
  const [autoRun, setAutoRun] = useState<AutoRunState | null>(null);

  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

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
    contextWarnings: taskWarnings[t.id],
  }));

  // Fetch tasks on mount and when project changes
  useEffect(() => {
    if (activeProjectId) {
      fetchTasks(activeProjectId);
    }
  }, [activeProjectId, fetchTasks]);

  // Event listeners for task execution streaming — mount once to prevent accumulation
  useEffect(() => {
    const outputUn = listen<{ job_id: string; line: string }>(EventName.TASK_EXEC_OUTPUT, (event) => {
      const { job_id, line } = event.payload;
      useSystemStore.getState().appendTaskOutput(job_id, line);
    });

    const statusUn = listen<{ job_id: string; status: string; error?: string }>(EventName.TASK_EXEC_STATUS, () => {
      const pid = activeProjectIdRef.current;
      if (pid) useSystemStore.getState().fetchTasks(pid);
    });

    const completeUn = listen<{ task_id: string; output_lines: number; context_warnings?: string[] }>(EventName.TASK_EXEC_COMPLETE, (event) => {
      const { task_id, context_warnings } = event.payload;
      if (context_warnings && context_warnings.length > 0) {
        setTaskWarnings((prev) => ({ ...prev, [task_id]: context_warnings }));
      }
      const pid = activeProjectIdRef.current;
      if (pid) useSystemStore.getState().fetchTasks(pid);
      setTimeout(() => {
        const store = useSystemStore.getState();
        const stillRunning = store.tasks.some((t) => t.status === 'running');
        if (!stillRunning) useOverviewStore.getState().processEnded('task_runner', 'completed');
      }, 500);
    });

    const autoRunCompleteUn = listen<{
      run_id: string;
      completed: number;
      failed: number;
      skipped: number;
      iterations: number;
      snapshot_size: number;
      termination_reason: string;
    }>(EventName.AUTO_RUN_COMPLETE, (event) => {
      const p = event.payload;
      setAutoRun((prev) =>
        prev && prev.runId === p.run_id
          ? {
              ...prev,
              status: p.termination_reason === 'cancelled' ? 'cancelled' : 'completed',
              result: {
                completed: p.completed,
                failed: p.failed,
                skipped: p.skipped,
                iterations: p.iterations,
                terminationReason: p.termination_reason,
              },
            }
          : prev,
      );
      const pid = activeProjectIdRef.current;
      if (pid) useSystemStore.getState().fetchTasks(pid);
      useOverviewStore.getState().processEnded('task_runner', 'completed');
    });

    return () => {
      outputUn.then(fn => fn());
      statusUn.then(fn => fn());
      completeUn.then(fn => fn());
      autoRunCompleteUn.then(fn => fn());
    };
  }, []);

  const handleAutoRun = useCallback(async () => {
    if (!activeProjectId || autoRun?.status === 'running') return;
    try {
      const { run_id, snapshot_size } = await startAutoRun(activeProjectId);
      setAutoRun({ runId: run_id, snapshotSize: snapshot_size, status: 'running' });
      useOverviewStore.getState().processStarted('task_runner', undefined, 'Auto-Run');
    } catch (e) {
      toastCatch('TaskRunnerPage:autoRun', t.plugins.dev_runner.auto_run_started)(e);
    }
  }, [activeProjectId, autoRun, t]);

  const handleCancelAutoRun = useCallback(async () => {
    if (!autoRun || autoRun.status !== 'running') return;
    await cancelAutoRun(autoRun.runId);
  }, [autoRun]);

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
      />

      <ContentBody>
        <ActionRow>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowModal(true)}
          >
            {t.plugins.dev_runner.new_task}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ListChecks className="w-3.5 h-3.5" />}
            onClick={() => batchFromAccepted()}
          >
            {t.plugins.dev_runner.batch_from_accepted}
          </Button>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            disabled={queuedCount === 0 && runningCount === 0}
            onClick={() => { startBatch(); useOverviewStore.getState().processStarted('task_runner', undefined, 'Task Runner Batch'); }}
          >
            {t.plugins.dev_runner.start_batch}
          </Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<InfinityIcon className="w-3.5 h-3.5" />}
            disabled={!activeProjectId || queuedCount === 0 || autoRun?.status === 'running'}
            onClick={handleAutoRun}
          >
            {t.plugins.dev_runner.auto_run_all}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<XCircle className="w-3.5 h-3.5" />}
            disabled={runningCount === 0 && queuedCount === 0}
            onClick={() => cancelAll()}
          >
            {t.plugins.dev_runner.cancel_all}
          </Button>
        </ActionRow>

        {autoRun && (
          <div className="border border-violet-500/25 rounded-card px-3 py-2 bg-violet-500/5 flex items-center gap-3 typo-caption">
            {autoRun.status === 'running' ? (
              <LoadingSpinner size="xs" />
            ) : autoRun.status === 'cancelled' ? (
              <Ban className="w-3.5 h-3.5 text-foreground" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="text-violet-400 font-medium">
              {autoRun.status === 'running'
                ? t.plugins.dev_runner.auto_run_progress
                : t.plugins.dev_runner.auto_run_complete}
            </span>
            <span className="text-foreground">
              {autoRun.result
                ? `${autoRun.result.completed}✓ ${autoRun.result.failed}✗ ${autoRun.result.skipped}↷ — ${autoRun.result.terminationReason}`
                : `${autoRun.snapshotSize} ${t.plugins.dev_runner.auto_run_iterations}`}
            </span>
            {autoRun.status === 'running' && (
              <Button
                variant="secondary"
                size="sm"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={handleCancelAutoRun}
              >
                {t.plugins.dev_runner.cancel_auto_run}
              </Button>
            )}
            {autoRun.status !== 'running' && (
              <Button
                variant="secondary"
                size="sm"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => setAutoRun(null)}
              >
                {t.plugins.dev_runner.cancel_all}
              </Button>
            )}
          </div>
        )}
        <div className="space-y-5">
          {/* Batch progress header */}
          {totalCount > 0 && (
            <div className="border border-primary/10 rounded-modal p-4 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="typo-section-title">{t.plugins.dev_runner.batch_progress}</h3>
                <div className="flex items-center gap-3 text-[10px] text-foreground">
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
              <p className="text-[10px] text-foreground mt-1.5 text-right">
                {Math.round(overallProgress)}{t.plugins.dev_runner.percent_overall}
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
            <h3 className="typo-label font-semibold uppercase tracking-wider text-primary mb-3">
              {t.plugins.dev_runner.task_queue}({totalCount})
            </h3>

            {tasks.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-primary/10 rounded-modal">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Play className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-md text-foreground mb-1">{t.plugins.dev_runner.no_tasks_queued}</p>
                <p className="text-md text-foreground mb-4">
                  {t.plugins.dev_runner.no_tasks_queued_sub}
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => setShowModal(true)}
                  >
                    {t.plugins.dev_runner.new_task}
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<ListChecks className="w-3.5 h-3.5" />}
                    onClick={() => batchFromAccepted()}
                  >
                    {t.plugins.dev_runner.batch_from_accepted}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, i) => {
                  const raw = storeTasks.find((st) => st.id === task.id);
                  if (!raw) return null;
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      rawTask={raw}
                      index={i}
                      outputLines={taskOutputBuffers[task.id] ?? []}
                    />
                  );
                })}
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
