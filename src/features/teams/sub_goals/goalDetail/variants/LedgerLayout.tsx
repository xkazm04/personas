// LEDGER - two columns, weighted 2:1. Work on the left, context in a rail.
//
// The thesis: the sections are not peers, and stacking them pretended they
// were. Four of the seven are things you DO (tasks, verification, sub-goals,
// hand-off) and three are things you CONSULT (dependencies, teams, activity).
// Give the doing column the width and the loud headings; give the consulting
// column a quiet rail that is visible without competing. The old layout had the
// same opinion - it hid the consult sections behind a collapsed card - but
// expressed it by HIDING them, which costs a click every time they matter.
//
// Size does the composing: the title is `typo-title-lg`, left headings are
// `tone="lead"` (primary icon, `typo-label`), rail headings stay `quiet`
// (uppercase `typo-caption`). Three distinct tiers instead of one.
import { useGoalDetailModel } from '../context';
import { AcceptanceGate, Description, Identity, Outcome, ProgressNudge, RefreshingLine } from '../blocks/leadBlocks';
import { Handoff, Subgoals, Tasks, UatGate } from '../blocks/workBlocks';
import { ActivityFeed, Dependencies, LinkedTeams } from '../blocks/contextBlocks';

export const LEDGER_WIDTH = 'max-w-[72rem]';

export function LedgerLayout() {
  const { goal } = useGoalDetailModel();
  if (!goal) return null;
  return (
    <div className="space-y-4">
      {/* Full width above the split: identity, and anything that is a DECISION.
          A decision that spans both columns cannot be missed by looking at the
          wrong one. */}
      <Identity size="lg" />
      <AcceptanceGate />
      <ProgressNudge />
      <RefreshingLine />

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-x-6 gap-y-4 items-start">
        <div className="min-w-0 space-y-4">
          <Description />
          <Tasks tone="lead" />
          <UatGate tone="lead" />
          <Subgoals tone="lead" />
          <Handoff />
        </div>

        {/* The rail. `lg:border-l` only, so at narrow widths the grid collapses
            to one column and the rule would be a stray horizontal line. */}
        <aside className="min-w-0 space-y-3 lg:border-l lg:border-primary/10 lg:pl-5">
          <Outcome />
          <Dependencies />
          <LinkedTeams />
          <ActivityFeed limit={8} />
        </aside>
      </div>
    </div>
  );
}
