import { useEffect, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { FolderKanban, AlertCircle, GitBranch } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { openProjectManager } from '@/features/companions/athena/guidance/appActions';
import { WorkspaceProjectSelector } from '../sub_workspaces/WorkspaceProjectSelector';
import { useWorkspaceSwitch } from '../sub_workspaces/useWorkspaceSwitch';
import { LT } from './lifecycleView/system/lcType';

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
 * repository indicator for the selected project (a Team practice lands through
 * pull requests, which need a repo). Colour by meaning: a linked repo reads in
 * the success tokens, a missing one in the warning tokens.
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

  // No projects at all: a compact inline CTA.
  if (projects.length === 0) {
    return (
      <Button
        variant="accent"
        tone="warning"
        size="sm"
        icon={<AlertCircle className="w-4 h-4" />}
        onClick={() => openProjectManager()}
      >
        {t.plugins.dev_tools.no_project_click_create}
      </Button>
    );
  }

  const hasGithub = Boolean(activeProject?.github_url);

  return (
    <div className="flex items-center gap-2 min-w-0 max-w-full">
      <WorkspaceProjectSelector allowNone={allowNone} testId="header-scope-picker" />
      {activeProject && (
        <Tooltip content={activeProject.github_url ?? t.plugins.dev_tools.no_repo}>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-interactive border shrink-0 ${
              hasGithub ? 'bg-status-success/10 border-status-success/25' : 'bg-status-warning/5 border-status-warning/20'
            }`}
          >
            {hasGithub ? (
              <>
                <GitBranch className="w-3.5 h-3.5 text-status-success shrink-0" />
                <span className={LT.meta}>{t.plugins.dev_lifecycle.lcx1_repo}</span>
              </>
            ) : (
              <>
                <FolderKanban className="w-3.5 h-3.5 text-status-warning shrink-0" />
                <span className={LT.meta}>{t.plugins.dev_tools.no_repo}</span>
              </>
            )}
          </div>
        </Tooltip>
      )}
    </div>
  );
}
