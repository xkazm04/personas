import { useState, useEffect, useCallback } from 'react';
import {
  FolderKanban, Plus, Target, ChevronRight, GripVertical,
  Trash2, CheckCircle2, Circle, Clock, AlertCircle, X, Folder,
  FolderOpen, Search, Pencil, MoreHorizontal, Network,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from "@/stores/systemStore";
import { useContextScanBackground } from '../hooks/useContextScanBackground';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { ImplementationLog } from './ImplementationLog';
import { GitHubRepoSelector } from './GitHubRepoSelector';
import { CrossProjectMetadataModal } from './CrossProjectMetadataModal';

// ---------------------------------------------------------------------------
// Types – thin view-models mapped from store bindings
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

/** Map a DevProject from the store into the local Project view-model. */
function toProject(dp: import("@/lib/bindings/DevProject").DevProject, goalCount: number): Project {
  return {
    id: dp.id,
    name: dp.name,
    path: dp.root_path,
    description: dp.description ?? undefined,
    techStack: dp.tech_stack ? dp.tech_stack.split(",").map((s) => s.trim()).filter(Boolean) : [],
    goalCount,
    status: (dp.status as Project["status"]) || "active",
    createdAt: dp.created_at.slice(0, 10),
  };
}

/** Map a DevGoal from the store into the local Goal view-model. */
function toGoal(dg: import("@/lib/bindings/DevGoal").DevGoal, signals: import("@/lib/bindings/DevGoalSignal").DevGoalSignal[]): Goal {
  return {
    id: dg.id,
    projectId: dg.project_id,
    title: dg.title,
    status: (dg.status as Goal["status"]) || "open",
    progress: dg.progress,
    signals: signals
      .filter((s) => s.goal_id === dg.id)
      .map((s) => ({
        id: s.id,
        message: s.message ?? s.signal_type,
        timestamp: s.created_at,
        type: (s.signal_type === "success" ? "success" : s.signal_type === "warning" ? "warning" : "info") as GoalSignal["type"],
      })),
  };
}

// ---------------------------------------------------------------------------
// Project Type Selector
// ---------------------------------------------------------------------------

type ProjectType = 'react' | 'nodejs' | 'fastapi' | 'rust' | 'python' | 'combined' | 'other';

const PROJECT_TYPES: { id: ProjectType; label: string; icon: string; color: string }[] = [
  { id: 'react', label: 'React', icon: '⚛️', color: 'bg-cyan-500/15 border-cyan-500/25 text-cyan-400' },
  { id: 'nodejs', label: 'NodeJS', icon: '🟢', color: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' },
  { id: 'fastapi', label: 'FastAPI', icon: '⚡', color: 'bg-teal-500/15 border-teal-500/25 text-teal-400' },
  { id: 'rust', label: 'Rust', icon: '🦀', color: 'bg-orange-500/15 border-orange-500/25 text-orange-400' },
  { id: 'python', label: 'Python', icon: '🐍', color: 'bg-yellow-500/15 border-yellow-500/25 text-yellow-400' },
  { id: 'combined', label: 'Combined', icon: '🔗', color: 'bg-violet-500/15 border-violet-500/25 text-violet-400' },
  { id: 'other', label: 'Other', icon: '📁', color: 'bg-primary/10 border-primary/20 text-muted-foreground' },
];

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
// Project Modal (create + edit modes)
// ---------------------------------------------------------------------------

type ModalStep = 'form' | 'created';

/** Data shape for an existing project being edited. */
interface EditProjectData {
  id: string;
  name: string;
  path: string;
  description: string;
  projectType: ProjectType;
  githubUrl: string;
}

function ProjectModal({
  open: isOpen,
  onClose,
  onCreate,
  onUpdate,
  onScanNow,
  editProject,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; path: string; description: string; projectType: ProjectType; githubUrl: string }) => Promise<{ id: string } | undefined>;
  onUpdate: (id: string, data: { name: string; description: string; projectType: ProjectType; githubUrl: string }) => Promise<void>;
  onScanNow: (projectId: string, rootPath: string, projectName: string) => void;
  editProject?: EditProjectData | null;
}) {
  const isEdit = !!editProject;

  const [step, setStep] = useState<ModalStep>('form');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('other');
  const [githubUrl, setGithubUrl] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [createdProject, setCreatedProject] = useState<{ id: string; name: string; path: string } | null>(null);
  const { shouldAnimate: _shouldAnimate } = useMotion();

  // Pre-fill form when editing
  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setPath(editProject.path);
      setDescription(editProject.description);
      setProjectType(editProject.projectType);
      setGithubUrl(editProject.githubUrl);
      setNameEdited(true);
    }
  }, [editProject]);

  const handleSelectFolder = async () => {
    if (isEdit) return; // path is read-only in edit mode
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select project folder',
      });
      if (!selected) return;
      const folderPath = typeof selected === 'string' ? selected : selected;
      setPath(folderPath);
      if (!nameEdited) {
        const segments = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        const folderName = segments[segments.length - 1] || '';
        setName(folderName);
      }
    } catch {
      // User cancelled or error -- silently ignore
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameEdited(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !path.trim()) return;

    if (isEdit && editProject) {
      await onUpdate(editProject.id, {
        name: name.trim(),
        description: description.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
      });
      handleClose();
    } else {
      const result = await onCreate({
        name: name.trim(),
        path: path.trim(),
        description: description.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
      });
      if (result) {
        setCreatedProject({ id: result.id, name: name.trim(), path: path.trim() });
        setStep('created');
      }
    }
  };

  const handleClose = () => {
    setStep('form');
    setName('');
    setPath('');
    setDescription('');
    setProjectType('other');
    setGithubUrl('');
    setNameEdited(false);
    setCreatedProject(null);
    onClose();
  };

  const handleScanNow = () => {
    if (createdProject) {
      onScanNow(createdProject.id, createdProject.path, createdProject.name);
    }
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div
        className="animate-fade-slide-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      >
        <div
          className="animate-fade-slide-in bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-elevation-4"
          onClick={(e) => e.stopPropagation()}
        >
          {step === 'form' ? (
            <>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-foreground/90">
                  {isEdit ? 'Edit Project' : 'New Project'}
                </h2>
                <Button variant="ghost" size="icon-sm" onClick={handleClose}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                {/* Folder picker (read-only in edit mode) */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Project Folder</label>
                  <div className="flex gap-2">
                    <div
                      onClick={isEdit ? undefined : handleSelectFolder}
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl min-w-0 ${
                        isEdit ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/60 transition-colors'
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      {path ? (
                        <span className="text-foreground truncate">{path}</span>
                      ) : (
                        <span className="text-muted-foreground/50">Select a folder...</span>
                      )}
                    </div>
                    {!isEdit && (
                      <Button variant="secondary" size="sm" onClick={handleSelectFolder}>
                        Browse
                      </Button>
                    )}
                  </div>
                </div>

                {/* Project Name */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    Project Name
                    {!isEdit && path && !nameEdited && (
                      <span className="text-[10px] text-muted-foreground/40 font-normal">(auto-filled from folder)</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="My Awesome App"
                      className="w-full px-3 py-2 pr-8 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-ring"
                    />
                    <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30" />
                  </div>
                </div>

                {/* Project Type */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    Project Type
                    <span className="text-[10px] text-muted-foreground/40 font-normal">(optional, visual only)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROJECT_TYPES.map((pt) => (
                      <button
                        key={pt.id}
                        onClick={() => setProjectType(pt.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                          projectType === pt.id
                            ? `${pt.color} ring-1 ring-current/20 scale-105`
                            : 'bg-secondary/30 border-primary/10 text-muted-foreground/60 hover:bg-secondary/50'
                        }`}
                      >
                        <span>{pt.icon}</span>
                        {pt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Purpose & Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this project do? Used by the Codebases connector so agents know each project's purpose and capabilities."
                    rows={3}
                    className="w-full px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus-ring resize-none"
                  />
                </div>

                {/* GitHub URL -- repo selector (if PAT available) or manual input */}
                <GitHubRepoSelector value={githubUrl} onChange={setGithubUrl} />
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
                <Button
                  variant="accent"
                  accentColor="amber"
                  size="sm"
                  icon={isEdit ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  disabled={!name.trim() || !path.trim()}
                  onClick={handleSubmit}
                >
                  {isEdit ? 'Save Changes' : 'Create Project'}
                </Button>
              </div>
            </>
          ) : (
            /* Post-creation step: offer context scan */
            <>
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h2 className="text-base font-semibold text-foreground/90 mb-1">
                  Project Created
                </h2>
                <p className="text-xs text-muted-foreground/60 mb-6">
                  <span className="font-medium text-foreground/70">{createdProject?.name}</span> is ready.
                  Would you like to generate a context map now?
                </p>

                <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 mb-6 text-left">
                  <div className="flex items-start gap-3">
                    <Search className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-foreground/80 mb-1">Generate Context Map</h4>
                      <p className="text-xs text-muted-foreground/60">
                        Scans your codebase to identify business features and organize them into context groups.
                        This runs in the background -- you&apos;ll get a notification when it&apos;s done.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    Skip for now
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<Search className="w-3.5 h-3.5" />}
                    onClick={handleScanNow}
                  >
                    Scan Codebase
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
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
  onAddNote,
  rawGoalSignals,
}: {
  goals: Goal[];
  onUpdateGoal: (id: string, data: Partial<Goal>) => void;
  onDeleteGoal: (id: string) => void;
  onCreateGoal: (title: string) => void;
  selectedGoalId: string | null;
  onSelectGoal: (id: string | null) => void;
  onAddNote: (goalId: string, message: string) => void;
  rawGoalSignals: import("@/lib/bindings/DevGoalSignal").DevGoalSignal[];
}) {
  const [newTitle, setNewTitle] = useState('');
  const { staggerDelay: _staggerDelay } = useMotion();

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
            {goals.map((goal, _i) => {
              const Icon = GOAL_ICONS[goal.status] ?? Circle;
              return (
                <div
                  key={goal.id}
                  className={`animate-fade-slide-in group flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
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
                </div>
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
            className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/40 focus-ring"
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

      {/* Implementation log sidebar */}
      {selectedGoal && (
        <div
          className="animate-fade-slide-in w-72 flex-shrink-0 border-l border-primary/10 pl-4 overflow-y-auto"
        >
          <ImplementationLog
            goalId={selectedGoal.id}
            signals={rawGoalSignals.filter((s) => s.goal_id === selectedGoal.id)}
            onAddNote={(msg) => onAddNote(selectedGoal.id, msg)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function ProjectRowMenu({ projectId, projectName, onEdit }: { projectId: string; projectName: string; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleteProject = useSystemStore((s) => s.deleteProject);

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onEdit();
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    await deleteProject(projectId);
    setOpen(false);
    setConfirming(false);
  };

  return (
    <div className="self-center relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); setConfirming(false); }}
        className="p-1 rounded-lg text-muted-foreground/30 hover:text-muted-foreground/60 hover:bg-secondary/40 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setConfirming(false); }} />
          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-primary/15 bg-background shadow-xl overflow-hidden py-1">
            <button
              type="button"
              onClick={handleEdit}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-foreground/70 hover:bg-primary/5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit Project
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                confirming ? 'bg-red-500/10 text-red-400' : 'text-red-400/70 hover:bg-red-500/5'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {confirming ? `Delete "${projectName.slice(0, 12)}"?` : 'Delete Project'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ProjectManagerPage() {
  // Store bindings
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const storeProjects = useSystemStore((s) => s.projects);
  const storeGoals = useSystemStore((s) => s.goals);
  const storeGoalSignals = useSystemStore((s) => s.goalSignals);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const createGoal = useSystemStore((s) => s.createGoal);
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const deleteGoal = useSystemStore((s) => s.deleteGoal);
  const fetchGoalSignals = useSystemStore((s) => s.fetchGoalSignals);
  const recordGoalSignal = useSystemStore((s) => s.recordGoalSignal);
  const { startBackgroundScan } = useContextScanBackground();

  // Map store data into view-models
  const goals: Goal[] = storeGoals.map((g) => toGoal(g, storeGoalSignals));
  const projects: Project[] = storeProjects.map((p) => {
    const goalCount = storeGoals.filter((g) => g.project_id === p.id).length;
    return toProject(p, goalCount);
  });
  const storeActiveProjectId = useSystemStore((s) => s.activeProjectId);
  const [activeProjectId, setLocalActiveProject] = useState<string | null>(storeActiveProjectId);
  const [showModal, setShowModal] = useState(false);
  const [showCrossProjectMap, setShowCrossProjectMap] = useState(false);
  const [editingProject, setEditingProject] = useState<EditProjectData | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    fetchProjects?.();
  }, []);

  // Sync local active with store (e.g., when project selector changes it)
  useEffect(() => {
    if (storeActiveProjectId && storeActiveProjectId !== activeProjectId) {
      setLocalActiveProject(storeActiveProjectId);
    }
  }, [storeActiveProjectId]);

  useEffect(() => {
    if (activeProjectId) fetchGoals?.(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (selectedGoalId) fetchGoalSignals?.(selectedGoalId);
  }, [selectedGoalId]);

  const handleCreateProject = useCallback(async (data: { name: string; path: string; description: string; projectType: ProjectType; githubUrl: string }) => {
    // If a project with this path already exists, activate it instead of creating a duplicate
    const existing = storeProjects.find((p) => p.root_path === data.path);
    if (existing) {
      setLocalActiveProject(existing.id);
      setActiveProject?.(existing.id);
      return { id: existing.id };
    }
    try {
      const project = await storeCreateProject(data.name, data.path, data.description, data.projectType, data.githubUrl || undefined);
      return { id: project.id };
    } catch {
      return undefined;
    }
  }, [storeCreateProject, storeProjects, setActiveProject]);

  const handleUpdateProject = useCallback(async (id: string, data: { name: string; description: string; projectType: ProjectType; githubUrl: string }) => {
    await storeUpdateProject(id, {
      name: data.name,
      description: data.description,
      techStack: data.projectType,
      githubUrl: data.githubUrl || undefined,
    });
  }, [storeUpdateProject]);

  const handleEditProject = useCallback((projectId: string) => {
    const raw = storeProjects.find((p) => p.id === projectId);
    if (!raw) return;
    // Resolve projectType from tech_stack
    const techStackLower = (raw.tech_stack ?? '').toLowerCase();
    const matchedType = PROJECT_TYPES.find((pt) => pt.id === techStackLower);
    setEditingProject({
      id: raw.id,
      name: raw.name,
      path: raw.root_path,
      description: raw.description ?? '',
      projectType: matchedType?.id ?? 'other',
      githubUrl: raw.github_url ?? '',
    });
    setShowModal(true);
  }, [storeProjects]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setEditingProject(null);
  }, []);

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
          <div className="flex items-center gap-2">
            <LifecycleProjectPicker />
            <Button
              variant="accent"
              accentColor="violet"
              size="sm"
              icon={<Network className="w-3.5 h-3.5" />}
              onClick={() => setShowCrossProjectMap(true)}
              disabledReason={projects.length === 0 ? 'Create at least one project first' : undefined}
              disabled={projects.length === 0}
            >
              Cross-Project Map
            </Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => { setEditingProject(null); setShowModal(true); }}
            >
              New Project
            </Button>
          </div>
        }
      />

      <ContentBody>
        <div className="space-y-6">
          {/* Active project header */}
          {activeProject ? (
            <div
              className="animate-fade-slide-in border border-primary/10 rounded-2xl p-5 bg-gradient-to-br from-amber-500/5 to-transparent"
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
                  onCreateGoal={(title) => activeProjectId ? createGoal?.(activeProjectId, title) : undefined}
                  selectedGoalId={selectedGoalId}
                  onSelectGoal={setSelectedGoalId}
                  onAddNote={(goalId, msg) => recordGoalSignal?.(goalId, 'manual_note', 0, msg)}
                  rawGoalSignals={storeGoalSignals}
                />
              </div>
            </div>
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
                  onClick={() => { setEditingProject(null); setShowModal(true); }}
                >
                  Create First Project
                </Button>
              </div>
            ) : (
              <div className="border border-primary/10 rounded-xl">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.6fr_0.7fr_40px] gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/10 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider rounded-t-xl">
                  <span>Name</span>
                  <span>Path</span>
                  <span>Tech Stack</span>
                  <span>Goals</span>
                  <span>Status</span>
                  <span>Created</span>
                  <span></span>
                </div>
                {/* Table rows */}
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => handleSetActive(project.id)}
                    className={`grid grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.6fr_0.7fr_40px] gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0 cursor-pointer transition-colors ${
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
                    <ProjectRowMenu projectId={project.id} projectName={project.name} onEdit={() => handleEditProject(project.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <ProjectModal
        open={showModal}
        onClose={handleCloseModal}
        onCreate={handleCreateProject}
        onUpdate={handleUpdateProject}
        onScanNow={startBackgroundScan}
        editProject={editingProject}
      />

      <CrossProjectMetadataModal
        open={showCrossProjectMap}
        onClose={() => setShowCrossProjectMap(false)}
      />
    </ContentBox>
  );
}
