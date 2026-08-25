// Launch tab entry — the Director mounts this from SkillsManagerPage. Owns
// the ONE useSkillLaunch call, the pre-render empty/loading states, and the
// consolidated Circuit surface (winner of the 2026-08 four-variant prototype).
import { FolderX, Library } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import CircuitVariant from './CircuitVariant';
import { useSkillLaunch } from './useSkillLaunch';

export function SkillLaunchTab() {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const data = useSkillLaunch(activeProjectId);

  const body = () => {
    if (!data.registryWired) {
      return (
        <EmptyState
          icon={Library}
          title={d.launch_no_registry_title}
          subtitle={d.launch_no_registry_hint}
        />
      );
    }
    // Cold load: nothing fetched yet — calm static ghost (no spinner; the
    // page chrome above stays rendered).
    if (data.loading && data.skills.length === 0) {
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 rounded-card border border-primary/5 bg-secondary/20" />
          ))}
        </div>
      );
    }
    // A skill is selected but the workspace resolves to zero projects.
    if (data.selectedSkill && !data.loading && data.cells.length === 0) {
      return (
        <EmptyState
          icon={FolderX}
          title={d.launch_no_projects_title}
          subtitle={d.launch_no_projects_hint}
        />
      );
    }
    return <CircuitVariant data={data} />;
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0" data-testid="skill-launch-tab">
      <div className="flex-1 min-h-0 overflow-y-auto">{body()}</div>
    </div>
  );
}
