import { lazy, Suspense, useEffect, useRef } from 'react';
import { FolderKanban, ChevronDown, AlertCircle } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const ProjectOverviewPage = lazy(() => import('./sub_overview/ProjectOverviewPage'));
const ProjectManagerPage = lazy(() => import('./sub_projects/ProjectManagerPage'));
const ContextMapPage = lazy(() => import('./sub_context/ContextMapPage'));
const IdeaScannerPage = lazy(() => import('./sub_scanner/IdeaScannerPage'));
const IdeaTriagePage = lazy(() => import('./sub_triage/IdeaTriagePage'));
const TaskRunnerPage = lazy(() => import('./sub_runner/TaskRunnerPage'));
const LifecyclePage = lazy(() => import('./sub_lifecycle/LifecyclePage'));
const SkillBrowserPage = lazy(() => import('./sub_skills/SkillBrowserPage'));


// ---------------------------------------------------------------------------
// Project Selector Banner — shown on all tabs except "projects"
// ---------------------------------------------------------------------------

export function ProjectSelector() {
  const projects = useSystemStore((s) => s.projects);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const loadedRef = useRef(false);

  // Fetch projects once
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      fetchProjects();
    }
  }, [fetchProjects]);

  // Auto-select first project if none is active
  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0]!.id);
    }
  }, [activeProjectId, projects, setActiveProject]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // No projects at all — prompt to create one
  if (projects.length === 0) {
    return (
      <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-amber-400/60 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/70">No dev project configured</p>
          <p className="text-[10px] text-muted-foreground/50">Create a project first to use scanner tools.</p>
        </div>
        <button
          onClick={() => setDevToolsTab('projects')}
          className="px-3 py-1.5 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors flex-shrink-0"
        >
          Create Project
        </button>
      </div>
    );
  }

  // Single project — just show it
  if (projects.length === 1 && activeProject) {
    return (
      <div className="mx-4 mt-3 mb-1 px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 flex items-center gap-2.5">
        <FolderKanban className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
        <span className="text-xs text-foreground/70 font-medium truncate">{activeProject.name}</span>
        <span className="text-[10px] text-muted-foreground/40 truncate">{activeProject.root_path}</span>
      </div>
    );
  }

  // Multiple projects — dropdown selector
  return (
    <div className="mx-4 mt-3 mb-1">
      <div className="relative">
        <select
          value={activeProjectId ?? ''}
          onChange={(e) => {
            if (e.target.value) setActiveProject(e.target.value);
          }}
          className="w-full appearance-none px-3 py-2 pl-9 pr-8 text-xs font-medium text-foreground/70 bg-primary/5 border border-primary/10 rounded-xl cursor-pointer hover:bg-primary/8 focus-ring transition-colors"
        >
          <option value="" disabled>Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.root_path}
            </option>
          ))}
        </select>
        <FolderKanban className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-amber-400/60 pointer-events-none" />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DevToolsPage() {
  const devToolsTab = useSystemStore((s) => s.devToolsTab);

  return (
    <div className="h-full w-full flex flex-col">
      <div
          data-testid="dev-tools-page"
          key={devToolsTab}
          className="animate-fade-slide-in flex-1 min-h-0 flex flex-col"
        >
          <Suspense fallback={<SuspenseFallback />}>
            {devToolsTab === 'overview' && <ProjectOverviewPage />}
            {devToolsTab === 'projects' && <ProjectManagerPage />}
            {devToolsTab === 'context-map' && <ContextMapPage />}
            {devToolsTab === 'idea-scanner' && <IdeaScannerPage />}
            {devToolsTab === 'idea-triage' && <IdeaTriagePage />}
            {devToolsTab === 'task-runner' && <TaskRunnerPage />}
            {devToolsTab === 'lifecycle' && <LifecyclePage />}
            {devToolsTab === 'skills' && <SkillBrowserPage />}
          </Suspense>
        </div>
    </div>
  );
}
