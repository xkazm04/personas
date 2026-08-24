// Launchpad variant — mission-control metaphor: the SkillCommandBar up top,
// then a responsive tile grid (one tile per workspace project) whose lights
// tell at a glance where the selected skill can launch right now.
import { Rocket } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import type { SkillLaunchData } from './launchTypes';
import { LaunchTile } from './LaunchTile';
import { SkillCommandBar } from './SkillCommandBar';
import { useAdoptConfirm, useLaunchWithFeedback } from './useAdoptConfirm';

export default function LaunchpadVariant({ data }: { data: SkillLaunchData }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { requestAdopt, adoptDialog } = useAdoptConfirm(data);
  const launch = useLaunchWithFeedback(data);

  // Stagger tile MOUNTING per SkillsManagerBoard's precedent (pattern v2 §3);
  // reset the wave when the skill (and therefore every status) changes.
  const reveal = useProgressiveReveal(data.cells.length, { resetKey: data.selectedSkill ?? '' });
  const enter = useRevealTracker(data.selectedSkill ?? '');

  const readyCount = data.cells.filter((c) => c.status === 'ready').length;

  return (
    <div className="flex flex-col gap-4 min-h-0" data-testid="launch-variant-launchpad">
      <SkillCommandBar data={data} />

      {!data.selectedSkill ? (
        <EmptyState
          icon={Rocket}
          title={d.launch_pick_skill_title}
          subtitle={d.launch_pick_skill_hint}
        />
      ) : (
        <>
          <div className="typo-label text-foreground">
            {tx(d.launch_coverage, { ready: readyCount, total: data.cells.length })}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {data.cells.slice(0, reveal.count).map((cell, index) => (
              <RevealItem
                key={cell.project.id}
                revealId={cell.project.id}
                order={index - reveal.newSince}
                {...enter}
              >
                <LaunchTile cell={cell} onLaunch={launch} onAdopt={requestAdopt} />
              </RevealItem>
            ))}
          </div>
        </>
      )}

      {adoptDialog}
    </div>
  );
}
