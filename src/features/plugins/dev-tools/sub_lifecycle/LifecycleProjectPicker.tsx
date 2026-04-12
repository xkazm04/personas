import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { FolderKanban, AlertCircle, GitBranch } from 'lucide-react';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Compact, themed project picker for the Lifecycle page header.
 *
 * Differences vs the DevToolsPage ProjectSelector:
 *  - Uses ThemedSelect (matches app themes)
 *  - Fixed width (~260px), not full-width
 *  - Inline with the header actions, not a separate row
 *  - Shows GitHub indicator when the selected project has a repo configured
 *    (Dev Clone adoption requires GitHub credentials to wire up PR workflows)
 */
export function LifecycleProjectPicker() {
  const { t } = useTranslation();
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

  // No projects at all — compact inline CTA
  if (projects.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setDevToolsTab('projects')}
        className="flex items-center gap-2 px-3 py-2 rounded-interactive bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/15 transition-colors"
      >
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="typo-body text-foreground">No project — click to create</span>
      </button>
    );
  }

  const hasGithub = Boolean(activeProject?.github_url);

  // Build themed options
  const options: ThemedSelectOption[] = projects.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.root_path,
  }));

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <ThemedSelect
          filterable
          options={options}
          value={activeProjectId ?? ''}
          onValueChange={(v) => setActiveProject(v)}
          placeholder={t.plugins.dev_tools.select_project}
          wrapperClassName="w-[260px]"
        />
      </div>
      {activeProject && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-interactive border ${
            hasGithub
              ? 'bg-emerald-500/10 border-emerald-500/25'
              : 'bg-amber-500/5 border-amber-500/20'
          }`}
          title={hasGithub ? activeProject.github_url ?? 'GitHub connected' : 'No GitHub repo — Dev Clone needs GitHub for PR workflows'}
        >
          {hasGithub ? (
            <>
              <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="typo-caption text-foreground">repo</span>
            </>
          ) : (
            <>
              <FolderKanban className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="typo-caption text-foreground">no repo</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
