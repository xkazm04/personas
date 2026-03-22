import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderKanban, Plus, Target, ChevronRight, GripVertical,
  Trash2, CheckCircle2, Circle, Clock, AlertCircle, X, Folder,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { usePersonaStore } from '@/stores/personaStore';

// ---------------------------------------------------------------------------
// Types (local until the devToolsSlice is wired)
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  techStack: string[];
  goalCount: number;
  status: 'active' | 'archived' | 'paused';
  createdAt: string;
}

interface Goal {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'in-progress' | 'done' | 'blocked';
  progress: number;
  signals: GoalSignal[];
}

interface GoalSignal {
  id: string;
  message: string;
  timestamp: string;
  type: 'info' | 'warning' | 'success';
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  archived: 'bg-primary/10 text-muted-foreground border-primary/15',
  paused: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  open: 'bg-primary/10 text-muted-foreground border-primary/15',
  'in-progress': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  blocked: 'bg-red-500/15 text-red-400 border-red-500/25',
};

const GOAL_ICONS: Record<string, typeof Circle> = {
  open: Circle,
  'in-progress': Clock,
  done: CheckCircle2,
  blocked: AlertCircle,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium border ${STATUS_STYLES[status] ?? STATUS_STYLES.open}`}>
      {status.replace('-', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Project Creation Modal
// ---------------------------------------------------------------------------

function ProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; path: string; description: string }) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const { shouldAnimate } = useMotion();

  const handleSubmit = () => {
    if (!name.trim() || !path.trim()) return;
    onCreate({ name: name.trim(), path: path.trim(), description: description.trim() });
    setName('');
    setPath('');
    setDescription('');
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
            <h2 className="text-base font-semibold text-foreground/90">New Project</h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Project Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome App"
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Directory Path</label>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/user/projects/my-app"
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the project..."
                rows={3}
                className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!name.trim() || !path.trim()}
              onClick={handleSubmit}
            >
              Create Project
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Goal Board
// ---------------------------------------------------------------------------

function GoalBoard({
  goals,
  onUpdateGoal: _onUpdateGoal,
  onDeleteGoal,
  onCreateGoal,
  selectedGoalId,
  onSelectGoal,
}: {
  goals: Goal[];
  onUpdateGoal: (id: string, data: Partial<Goal>) => void;
  onDeleteGoal: (id: string) => void;
  onCreateGoal: (title: string) => void;
  selectedGoalId: string | null;
  onSelectGoal: (id: string | null) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const { staggerDelay } = useMotion();

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreateGoal(newTitle.trim());
    setNewTitle('');
  };

  const selectedGoal = goals.find((g) => g.id === selectedGoalId);

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Goal list */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground/80">Goals</h3>
          <span className="text-xs text-muted-foreground/60">{goals.length}</span>
        </div>

        {goals.length === 0 ? (
          <div className="text-center py-12">
            <Target className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/60">No goals yet. Add one below.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {goals.map((goal, i) => {
              const Icon = GOAL_ICONS[goal.status] ?? Circle;
              return (
                <motion.div
                  key={goal.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * staggerDelay }}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    selectedGoalId === goal.id
                      ? 'bg-primary/10 border-primary/20'
                      : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
                  }`}
                  onClick={() => onSelectGoal(selectedGoalId === goal.id ? null : goal.id)}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
                  <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground/60" />
                  <span className="flex-1 min-w-0 text-sm text-foreground/80 truncate">{goal.title}</span>
                  <div className="w-20 h-1.5 bg-primary/10 rounded-full overflow-hidden flex-shrink-0">
                    <div
                      className="h-full bg-amber-400/60 rounded-full transition-all"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                  <StatusBadge status={goal.status} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onDeleteGoal(goal.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Inline goal creation */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-primary/5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Add a goal..."
            className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            disabled={!newTitle.trim()}
            onClick={handleCreate}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Signal timeline sidebar */}
      {selectedGoal && (
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-72 flex-shrink-0 border-l border-primary/10 pl-4 overflow-y-auto"
        >
          <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3">
            Signal Timeline
          </h4>
          {selectedGoal.signals.length === 0 ? (
            <p className="text-xs text-muted-foreground/50">No signals recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {selectedGoal.signals.map((signal) => (
                <div key={signal.id} className="flex gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    signal.type === 'success' ? 'bg-emerald-400' :
                    signal.type === 'warning' ? 'bg-amber-400' : 'bg-blue-400'
                  }`} />
                  <div>
                    <p className="text-xs text-foreground/70">{signal.message}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">{signal.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProjectManagerPage() {
  // Store bindings (will be wired when devToolsSlice is ready)
  const store = usePersonaStore.getState();
  const fetchProjects = (store as unknown as Record<string, unknown>).fetchProjects as (() => Promise<void>) | undefined;
  const createProject = (store as unknown as Record<string, unknown>).createProject as ((data: Record<string, unknown>) => Promise<void>) | undefined;
  const setActiveProject = (store as unknown as Record<string, unknown>).setActiveProject as ((id: string) => void) | undefined;
  const fetchGoals = (store as unknown as Record<string, unknown>).fetchGoals as ((projectId: string) => Promise<void>) | undefined;
  const createGoal = (store as unknown as Record<string, unknown>).createGoal as ((data: Record<string, unknown>) => Promise<void>) | undefined;
  const updateGoal = (store as unknown as Record<string, unknown>).updateGoal as ((id: string, data: Record<string, unknown>) => Promise<void>) | undefined;
  const deleteGoal = (store as unknown as Record<string, unknown>).deleteGoal as ((id: string) => Promise<void>) | undefined;

  // Local state (until slice provides it)
  const [projects] = useState<Project[]>([]);
  const [goals] = useState<Goal[]>([]);
  const [activeProjectId, setLocalActiveProject] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    fetchProjects?.();
  }, []);

  useEffect(() => {
    if (activeProjectId) fetchGoals?.(activeProjectId);
  }, [activeProjectId]);

  const handleCreateProject = useCallback((data: { name: string; path: string; description: string }) => {
    createProject?.(data);
  }, [createProject]);

  const handleSetActive = useCallback((id: string) => {
    setLocalActiveProject(id);
    setActiveProject?.(id);
  }, [setActiveProject]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<FolderKanban className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Projects"
        subtitle="Manage local development projects and goals"
        actions={
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowModal(true)}
          >
            New Project
          </Button>
        }
      />

      <ContentBody>
        <div className="space-y-6">
          {/* Active project header */}
          {activeProject ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-primary/10 rounded-2xl p-5 bg-gradient-to-br from-amber-500/5 to-transparent"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                  <Folder className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-foreground/90">{activeProject.name}</h2>
                  <p className="text-xs text-muted-foreground/60 truncate">{activeProject.path}</p>
                </div>
                <StatusBadge status={activeProject.status} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Goals', value: activeProject.goalCount },
                  { label: 'Tech Stack', value: activeProject.techStack.join(', ') || 'N/A' },
                  { label: 'Created', value: activeProject.createdAt },
                ].map((stat) => (
                  <div key={stat.label} className="bg-primary/5 rounded-xl px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">{stat.label}</p>
                    <p className="text-sm text-foreground/80 mt-0.5 truncate">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <GoalBoard
                  goals={goals}
                  onUpdateGoal={(id, data) => updateGoal?.(id, data)}
                  onDeleteGoal={(id) => deleteGoal?.(id)}
                  onCreateGoal={(title) => createGoal?.({ title, projectId: activeProjectId })}
                  selectedGoalId={selectedGoalId}
                  onSelectGoal={setSelectedGoalId}
                />
              </div>
            </motion.div>
          ) : (
            <div className="border border-dashed border-primary/10 rounded-2xl p-8 text-center">
              <Folder className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/60">Select a project below or create a new one</p>
            </div>
          )}

          {/* Project list */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3">
              All Projects ({projects.length})
            </h3>

            {projects.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <FolderKanban className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-sm text-muted-foreground/60 mb-4">No projects yet</p>
                <Button
                  variant="accent"
                  accentColor="amber"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setShowModal(true)}
                >
                  Create First Project
                </Button>
              </div>
            ) : (
              <div className="border border-primary/10 rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.6fr_0.7fr] gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/10 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                  <span>Name</span>
                  <span>Path</span>
                  <span>Tech Stack</span>
                  <span>Goals</span>
                  <span>Status</span>
                  <span>Created</span>
                </div>
                {/* Table rows */}
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => handleSetActive(project.id)}
                    className={`grid grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.6fr_0.7fr] gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0 cursor-pointer transition-colors ${
                      activeProjectId === project.id
                        ? 'bg-primary/10'
                        : 'hover:bg-primary/5'
                    }`}
                  >
                    <span className="text-sm text-foreground/80 font-medium flex items-center gap-2 truncate">
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${activeProjectId === project.id ? 'rotate-90' : ''}`} />
                      {project.name}
                    </span>
                    <span className="text-xs text-muted-foreground/60 truncate self-center">{project.path}</span>
                    <span className="text-xs text-muted-foreground/60 truncate self-center">{project.techStack.join(', ')}</span>
                    <span className="text-xs text-muted-foreground/60 self-center">{project.goalCount}</span>
                    <span className="self-center"><StatusBadge status={project.status} /></span>
                    <span className="text-xs text-muted-foreground/60 self-center">{project.createdAt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <ProjectModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreateProject}
      />
    </ContentBox>
  );
}
