// LEDGER - the winning layout (owner's call, 2026-10-06), now rendered through
// the shared modal standard.
//
// The layout thesis is unchanged: the sections are not peers. Four of them are
// things you DO (tasks, verification, sub-goals, hand-off) and three are things
// you CONSULT (dependencies, teams, activity). The doing column gets the width
// and the loud headings; the consulting column gets a quiet rail that is visible
// without competing.
//
// WHAT CHANGED is everything about how it is STYLED. This file used to hand-roll
// its own panel classes, its own header and its own section rule - which is what
// made the modal read as foreign to the rest of the app. It now composes
// `ModalShell`, so the surface, radius token, elevation, header tiers, scroll
// region and section rhythm all come from one place, and the `skin` prop is the
// only thing that varies between the three styling approaches.
import { Pencil } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { ModalShell, type ModalSkin } from '@/features/shared/components/modals/ModalShell';

import { useGoalDetailModel } from '../context';
import { GoalStatusBadge } from '../../GoalStatusBadge';
import { AcceptanceGate, Description, Outcome, ProgressNudge, RefreshingLine } from '../blocks/leadBlocks';
import { Handoff, Subgoals, Tasks, UatGate } from '../blocks/workBlocks';
import { ActivityFeed, Dependencies, LinkedTeams } from '../blocks/contextBlocks';

export function LedgerLayout({ skin, isOpen }: { skin: ModalSkin; isOpen: boolean }) {
  const { goal, onEdit, onClose, t } = useGoalDetailModel();
  if (!goal) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="goal-detail-title"
      skin={skin}
      width="lg"
      title={goal.title}
      status={
        <>
          <GoalStatusBadge status={goal.status} />
          <span className="typo-caption text-foreground tabular-nums">{goal.progress}%</span>
        </>
      }
      actions={
        <Button variant="ghost" size="sm" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => onEdit(goal)}>
          {t.common.edit}
        </Button>
      }
    >
      {/* Full width above the split: anything that is a DECISION. A decision
          that spans both columns cannot be missed by looking at the wrong one. */}
      <div className="space-y-4">
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

          {/* The rail. `lg:border-l` only, so at narrow widths the grid
              collapses to one column and the rule would be a stray line. */}
          <aside className="min-w-0 space-y-3 lg:border-l lg:border-primary/10 lg:pl-5">
            <Outcome />
            <Dependencies />
            <LinkedTeams />
            <ActivityFeed limit={8} />
          </aside>
        </div>
      </div>
    </ModalShell>
  );
}
