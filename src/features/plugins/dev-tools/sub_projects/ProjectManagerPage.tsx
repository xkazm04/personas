import { useState, useEffect, useCallback } from 'react';
import {
  FolderKanban, Plus, ChevronRight, Folder, Network,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useContextScanBackground } from '../hooks/useContextScanBackground';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { CrossProjectMetadataModal } from './CrossProjectMetadataModal';
import { useTranslation } from '@/i18n/useTranslation';
import {
  type Project, type Goal, type ProjectType, type EditProjectData,
  toProject, toGoal, PROJECT_TYPES, StatusBadge,
} from './projectManagerTypes';
import { ProjectModal } from './ProjectModal';
import { GoalBoard, ProjectRowMenu } from './ProjectManagerParts';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProjectManagerPage() {
  const { t } = useTranslation();
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

  const handleCreateProject = useCallback(async (data: { name: string; path: string; projectType: ProjectType; githubUrl: string }) => {
    // If a project with this path already exists, activate it instead of creating a duplicate
    const existing = storeProjects.find((p) => p.root_path === data.path);
    if (existing) {
      setLocalActiveProject(existing.id);
      setActiveProject?.(existing.id);
      return { id: existing.id };
    }
    try {
      const project = await storeCreateProject(data.name, data.path, '', data.projectType, data.githubUrl || undefined);
      return { id: project.id };
    } catch {
      return undefined;
    }
  }, [storeCreateProject, storeProjects, setActiveProject]);

  const handleUpdateProject = useCallback(async (id: string, data: { name: string; projectType: ProjectType; githubUrl: string }) => {
    await storeUpdateProject(id, {
      name: data.name,
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
        title={t.plugins.dev_tools.projects_title}
        subtitle={t.plugins.dev_tools.projects_subtitle}
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
                <div className="w-10 h-10 rounded-modal bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                  <Folder className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="typo-section-title">{activeProject.name}</h2>
                  <p className="typo-caption text-foreground truncate">{activeProject.path}</p>
                </div>
                <StatusBadge status={activeProject.status} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Goals', value: activeProject.goalCount },
                  { label: 'Tech Stack', value: activeProject.techStack.join(', ') || 'N/A' },
                  { label: 'Created', value: activeProject.createdAt },
                ].map((stat) => (
                  <div key={stat.label} className="bg-primary/5 rounded-modal px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-primary font-medium">{stat.label}</p>
                    <p className="text-md text-foreground mt-0.5 truncate">{stat.value}</p>
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
              <Folder className="w-8 h-8 text-foreground mx-auto mb-2" />
              <p className="text-md text-foreground">Select a project below or create a new one</p>
            </div>
          )}

          {/* Project list */}
          <div>
            <h3 className="typo-label font-semibold text-primary uppercase tracking-wider mb-3">
              All Projects ({projects.length})
            </h3>

            {projects.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <FolderKanban className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-md text-foreground mb-4">No projects yet</p>
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
              <div className="border border-primary/10 rounded-modal">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1.2fr_0.8fr_0.5fr_0.6fr_0.7fr_40px] gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/10 typo-label font-medium text-primary uppercase tracking-wider rounded-t-xl">
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
                    <span className="text-md text-foreground font-medium flex items-center gap-2 truncate">
                      <ChevronRight className={`w-3.5 h-3.5 text-foreground transition-transform ${activeProjectId === project.id ? 'rotate-90' : ''}`} />
                      {project.name}
                    </span>
                    <span className="typo-caption text-foreground truncate self-center">{project.path}</span>
                    <span className="typo-caption text-foreground truncate self-center">{project.techStack.join(', ')}</span>
                    <span className="typo-caption text-foreground self-center">{project.goalCount}</span>
                    <span className="self-center"><StatusBadge status={project.status} /></span>
                    <span className="typo-caption text-foreground self-center">{project.createdAt}</span>
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
