import { useEffect, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { FolderKanban, AlertCircle, GitBranch } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { openProjectManager } from '@/features/companions/athena/guidance/appActions';
import { WorkspaceProjectSelector } from '../sub_workspaces/WorkspaceProjectSelector';
import { useWorkspaceSwitch } from '../sub_workspaces/useWorkspaceSwitch';

interface LifecycleProjectPickerProps {
  /**
   * Allow "No active project" so the page can scope to a whole workspace or
   * every project (Goals, KPIs). Pages that act on ONE project leave this off
   * and the picker keeps a project selected.
   */
  allowNone?: boolean;
}

/**
 * Page-header scope picker: the universal workspace / project selector plus a
 * GitHub indicator for the selected project (Dev Clone adoption needs a repo
 * to wire up PR workflows).
 */
export function LifecycleProjectPicker({ allowNone = false }: LifecycleProjectPickerProps) {
  const { t } = useTranslation();
  const { projects, scoped, activeProjectId, activeProject, setActiveProject } = useWorkspaceSwitch();

  const firstByName = useMemo(
    () => [...scoped].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))[0] ?? null,
    [scoped],
  );

  // Single-project pages always act on a project: select the first (by name)
  // in the active workspace when none is active.
  useEffect(() => {
    if (!allowNone && !activeProjectId && firstByName) void setActiveProject(firstByName.id);
  }, [allowNone, activeProjectId, firstByName, setActiveProject]);

  // No projects at all — compact inline CTA
  if (projects.length === 0) {
    return (
      <button
        type="button"
        onClick={() => openProjectManager()}
        className="flex items-center gap-2 px-3 py-2 rounded-interactive bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/15 transition-colors"
      >
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="typo-body text-foreground">{t.plugins.dev_tools.no_project_click_create}</span>
      </button>
    );
  }

  const hasGithub = Boolean(activeProject?.github_url);

  return (
    <div className="flex items-center gap-2 min-w-0 max-w-full">
      <WorkspaceProjectSelector allowNone={allowNone} testId="header-scope-picker" />
      {activeProject && (
        <Tooltip content={hasGithub ? activeProject.github_url ?? 'GitHub connected' : 'No GitHub repo — Dev Clone needs GitHub for PR workflows'}>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-interactive border shrink-0 ${
              hasGithub ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-amber-500/5 border-amber-500/20'
            }`}
          >
            {hasGithub ? (
              <>
                <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="typo-caption text-foreground">repo</span>
              </>
            ) : (
              <>
                <FolderKanban className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="typo-caption text-foreground">{t.plugins.dev_tools.no_repo}</span>
              </>
            )}
          </div>
        </Tooltip>
      )}
    </div>
  );
}
