// Launch tab entry — the Director mounts this from SkillsManagerPage. Owns
// the ONE useSkillLaunch call (variants share its state; switching variants
// never refetches), the pre-variant empty/loading states, and the throwaway
// variant switcher the live evaluation will consolidate.
import { lazy, Suspense, useState } from 'react';
import { FolderX, Library } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { useSkillLaunch } from './useSkillLaunch';

// Lazy per-variant chunks: the shared `data` prop flows into whichever chunk
// is active; the inactive variants never parse (loading-pattern v2 §1).
const LaunchpadVariant = lazy(() => import('./LaunchpadVariant'));
const AtlasVariant = lazy(() => import('./AtlasVariant'));
const CircuitVariant = lazy(() => import('./CircuitVariant'));
const BriefingVariant = lazy(() => import('./BriefingVariant'));

type LaunchVariant = 'launchpad' | 'atlas' | 'circuit' | 'briefing';

export function SkillLaunchTab() {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const data = useSkillLaunch(activeProjectId);

  // TODO(prototype, 2026-08-23): consolidate Launch variant switcher after live evaluation
  const [variant, setVariant] = useState<LaunchVariant>('launchpad');

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
    // Cold load: nothing fetched yet — calm static ghost under the strip
    // (no spinner; chrome above stays rendered).
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
    const Active = variant === 'launchpad' ? LaunchpadVariant
      : variant === 'atlas' ? AtlasVariant
        : variant === 'circuit' ? CircuitVariant
          : BriefingVariant;
    return (
      <Suspense fallback={null}>
        <Active data={data} />
      </Suspense>
    );
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0" data-testid="skill-launch-tab">
      <SegmentedTabs<LaunchVariant>
        tabs={[
          { id: 'launchpad', label: d.launch_variant_launchpad },
          { id: 'atlas', label: d.launch_variant_atlas },
          { id: 'circuit', label: d.launch_variant_circuit },
          { id: 'briefing', label: d.launch_variant_briefing },
        ]}
        activeTab={variant}
        onTabChange={setVariant}
        ariaLabel={d.launch_variant_aria}
        variant="segment"
        size="sm"
        fullWidth={false}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">{body()}</div>
    </div>
  );
}
