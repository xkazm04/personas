// BRIEF - a reading column that stays narrow, beside a shelf that holds one
// panel at a time.
//
// The thesis neither of the others takes: spreading to width is not always an
// improvement. A description and a task list are READING, and prose set across
// 1100px is harder to read, not easier - the column stays at a sane measure on
// purpose. What the extra width buys is that the four consult-and-occasional
// surfaces stop being a scroll: they become a shelf where exactly one is open,
// so the surface has a constant height and you never lose your place in the
// tasks by opening dependencies.
//
// Size composes by CONTRAST rather than by tier count: one loud title, one
// `lead` heading in the column, and shelf tabs at `typo-caption`. The open
// panel's heading is suppressed entirely - the pressed tab already names it,
// and repeating it is the kind of duplicated chrome the owner has flagged
// before.
import { useState } from 'react';

import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';

import { useGoalDetailModel } from '../context';
import { AcceptanceGate, Description, Identity, ProgressNudge, RefreshingLine, Outcome } from '../blocks/leadBlocks';
import { Handoff, Subgoals, Tasks, UatGate } from '../blocks/workBlocks';
import { ActivityFeed, Dependencies, LinkedTeams } from '../blocks/contextBlocks';

export const BRIEF_WIDTH = 'max-w-[68rem]';

type ShelfId = 'verify' | 'subgoals' | 'deps' | 'teams' | 'activity';

export function BriefLayout() {
  const { dl, goal, subgoals, assignments, signals, isWebProject, verifyItem } = useGoalDetailModel();
  const shelf: Array<{ id: ShelfId; label: string; show: boolean }> = [
    { id: 'verify', label: dl.uat_section_title, show: isWebProject || !!verifyItem },
    { id: 'subgoals', label: dl.goal_detail_subgoals, show: subgoals.length > 0 },
    { id: 'deps', label: dl.goal_detail_dependencies, show: true },
    { id: 'teams', label: dl.goal_detail_linked_teams, show: assignments.length > 0 },
    { id: 'activity', label: dl.goal_detail_activity, show: signals.length > 0 },
  ];
  const tabs = shelf.filter((s) => s.show);
  const [open, setOpen] = useState<ShelfId>('deps');
  // The remembered tab can stop existing (its section emptied out between
  // opens), so the rendered tab is always one that is actually on the shelf.
  // `deps` is unconditional above, so the shelf is never empty; the `?? 'deps'`
  // is what tells the type checker that, rather than a guess.
  const active: ShelfId = tabs.some((s2) => s2.id === open) ? open : tabs[0]?.id ?? 'deps';
  if (!goal) return null;

  return (
    <div className="space-y-4">
      <Identity size="lg" />
      <AcceptanceGate />
      <ProgressNudge />
      <RefreshingLine />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,34rem)_1fr] gap-x-6 gap-y-4 items-start">
        {/* THE READING COLUMN. Capped, deliberately. */}
        <div className="min-w-0 space-y-4">
          <Description />
          <Tasks tone="lead" />
          <Handoff />
        </div>

        {/* THE SHELF. One panel at a time, so the surface height is constant. */}
        <div className="min-w-0 lg:border-l lg:border-primary/10 lg:pl-5">
          <Outcome />
          {/* The shared tab strip, not a hand-rolled one: `PanelTabBar` owns
              the roles, the arrow-key behaviour and the sliding underline. */}
          <div className="mt-3">
            <PanelTabBar<ShelfId>
              tabs={tabs.map((s2) => ({ id: s2.id, label: s2.label }))}
              activeTab={active}
              onTabChange={setOpen}
              underlineClass="bg-primary"
              idPrefix="goal-detail-shelf"
            />
          </div>
          {/* A real `role="tabpanel"`, labelled by the tab that selects it.
              `PanelTabBar` advertises that it chooses among mutually exclusive
              regions; without a declared panel that relationship exists only in
              the visual layout and no screen reader can follow it
              (`tabstrip-with-no-declared-panel`). The panel carries no heading
              of its own - the pressed tab IS the heading, and printing it twice
              is duplicated chrome. */}
          <div
            role="tabpanel"
            id={`goal-detail-shelf-panel-${active}`}
            aria-labelledby={`goal-detail-shelf-tab-${active}`}
            tabIndex={0}
            className="pt-3 min-h-[12rem] focus-ring"
          >
            {active === 'verify' && <UatGate />}
            {active === 'subgoals' && <Subgoals />}
            {active === 'deps' && <Dependencies />}
            {active === 'teams' && <LinkedTeams />}
            {active === 'activity' && <ActivityFeed limit={20} />}
          </div>
        </div>
      </div>
    </div>
  );
}
