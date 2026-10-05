// COLUMN - the layout as it shipped, kept as the baseline to compare against.
//
// Seven sections stacked in one 800px column, with the three consult-only ones
// folded into a collapsed "More details" card at the bottom because there was
// nowhere else for them to go. This is the arrangement the owner called "one
// large column instead of spreading to width"; it stays selectable so the three
// alternatives can be judged against it rather than against a memory of it.
import { SectionCard } from '@/features/shared/components/layout/SectionCard';

import { useGoalDetailModel } from '../context';
import { AcceptanceGate, Description, Identity, Outcome, ProgressNudge, RefreshingLine } from '../blocks/leadBlocks';
import { Handoff, Subgoals, Tasks, UatGate } from '../blocks/workBlocks';
import { ActivityFeed, Dependencies, LinkedTeams } from '../blocks/contextBlocks';

export const COLUMN_WIDTH = 'max-w-[50rem]';

export function ColumnLayout() {
  const { dl } = useGoalDetailModel();
  return (
    <div className="space-y-4">
      <Identity />
      <Description />
      <Outcome />
      <AcceptanceGate />
      <ProgressNudge />
      <RefreshingLine />
      <Tasks />
      <UatGate />
      <Subgoals />
      <Handoff />
      <SectionCard
        collapsible
        title={dl.goal_more_details}
        subtitle={dl.goal_more_details_hint}
        storageKey="goals.detailDrawer.moreDetails"
        defaultCollapsed
        size="sm"
        className="mt-3"
      >
        <Dependencies />
        <LinkedTeams />
        <ActivityFeed />
      </SectionCard>
    </div>
  );
}
