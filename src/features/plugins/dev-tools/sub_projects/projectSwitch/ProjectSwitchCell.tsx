import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useToggleProject } from './useProjectSwitch';

/**
 * The project switch as a table cell (Projects page). Reads the live store row
 * rather than the table's view-model so a flip from the Monitor's column menu
 * shows here without a refetch. The click never reaches the row, which would
 * otherwise also make the project active.
 */
export function ProjectSwitchCell({ projectId }: { projectId: string }) {
  const { t, tx } = useTranslation();
  const project = useSystemStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const toggle = useToggleProject();
  if (!project) return null;
  const dp = t.plugins.dev_projects;
  return (
    <span className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <Tooltip content={project.enabled ? dp.project_switch_off : tx(dp.project_off_hint, { project: project.name })}>
        <span className="inline-flex">
          <AccessibleToggle
            size="sm"
            checked={project.enabled}
            onChange={() => { void toggle(project); }}
            label={project.enabled ? dp.project_switch_off : dp.project_switch_on}
            data-testid={`project-switch-${project.id}`}
          />
        </span>
      </Tooltip>
    </span>
  );
}
