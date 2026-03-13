import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Plus, ListChecks, XCircle, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, AlertCircle, Clock, Ban, X, Link2,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';

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

function TaskModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { title: string; description: string; goalId?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalId, setGoalId] = useState('');
  const { shouldAnimate } = useMotion();

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim(), goalId: goalId.trim() || undefined });
    setTitle('');
    setDescription('');
    setGoalId('');
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: shouldAnimate ? 0.95 : 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: shouldAnimate ? 0.95 : 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-foreground/90">New Task</h2>
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
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this task should accomplish..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 resize-none"
              />
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
                  className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30"
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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Task Card
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  index,
}: {
  task: RunnerTask;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { staggerDelay } = useMotion();
  const phaseCfg = PHASE_CONFIG[task.phase];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * staggerDelay }}
      className="border border-primary/10 rounded-xl overflow-hidden hover:border-primary/20 transition-colors"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusBadge status={task.status} />

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground/80 truncate">{task.title}</h4>
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
              <motion.div
                className={`h-full ${phaseCfg.color} rounded-full`}
                initial={{ width: 0 }}
                animate={{ width: `${task.progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground/40 w-8 text-right">
              {Math.round(task.progress)}%
            </span>
          </div>
        )}

        {/* Expand button for output */}
        {task.output && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>

      {/* Expanded output */}
      <AnimatePresence>
        {expanded && task.output && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0">
              <pre className="text-[11px] text-muted-foreground/60 bg-primary/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                {task.output}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TaskRunnerPage() {
  const store = useSystemStore.getState();
  const createTask = (store as any).createRunnerTask as ((data: any) => Promise<void>) | undefined;
  const batchFromAccepted = (store as any).batchFromAcceptedIdeas as (() => Promise<void>) | undefined;
  const startBatch = (store as any).startBatch as (() => Promise<void>) | undefined;
  const cancelAll = (store as any).cancelAllTasks as (() => Promise<void>) | undefined;

  const [tasks] = useState<RunnerTask[]>([]);
  const [showModal, setShowModal] = useState(false);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const totalCount = tasks.length;

  const overallProgress = totalCount > 0
    ? tasks.reduce((acc, t) => acc + t.progress, 0) / totalCount
    : 0;

  const handleCreateTask = useCallback((data: { title: string; description: string; goalId?: string }) => {
    createTask?.(data);
  }, [createTask]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Play className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Task Runner"
        subtitle="Batch execution queue for accepted tasks"
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
              onClick={() => batchFromAccepted?.()}
            >
              Batch from Accepted
            </Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Play className="w-3.5 h-3.5" />}
              disabled={queuedCount === 0 && runningCount === 0}
              onClick={() => startBatch?.()}
            >
              Start Batch
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<XCircle className="w-3.5 h-3.5" />}
              disabled={runningCount === 0 && queuedCount === 0}
              onClick={() => cancelAll?.()}
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
                      <Loader2 className="w-3 h-3 animate-spin" /> {runningCount} running
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
                <motion.div
                  className="h-full bg-amber-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${overallProgress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
                {Math.round(overallProgress)}% overall
              </p>
            </div>
          )}

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
                    onClick={() => batchFromAccepted?.()}
                  >
                    Batch from Accepted
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, i) => (
                  <TaskCard key={task.id} task={task} index={i} />
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
