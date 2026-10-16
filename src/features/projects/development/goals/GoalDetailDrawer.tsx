/**
 * GoalDetailDrawer - the focused detail surface for a single goal.
 *
 * Composes the goal's hybrid progress nudge (resolve_goal_progress ->
 * accept/edit; never silent), the unified checklist (ad-hoc items, sub-goals and
 * linked team-assignment steps, with inline intervention on awaiting_review),
 * the verification gate, and the live activity feed (dev_goal_signals, incl. the
 * team_* signals the orchestrator writes).
 *
 * 2026-10-05 - SHELL ONLY. The data moved to `goalDetail/useGoalDetail` behind a
 * context and the sections became blocks, so a layout is a small file that
 * arranges blocks.
 *
 * 2026-10-06 - LEDGER WON, THEN RAISED WON, AND BOTH CONTESTS ARE CLOSED.
 *
 * The layout contest settled first: Ledger is the layout, and Column, Dossier
 * and Brief are gone. The styling contest settled next: of the three skins this
 * drawer carried for an afternoon, RAISED won, and flat and editorial are gone
 * with it. There is no switcher here any more because there is nothing left to
 * switch - which is the point. A standard with three variants is not a standard.
 *
 * What the exercise produced is `shared/components/modals/ModalShell`, which now
 * owns the modal INTERIOR for the whole app: the surface on the radius token, the
 * tinted header band, content on inset panels, one scroll region, the footer bar,
 * and - after the owner's second note - ONE section-heading token.
 *
 * That last part was the real finding. Measured inside this one modal: five
 * different section-heading treatments, including `typo-caption uppercase
 * tracking-[0.16em]` sitting 0.02em from its own neighbour at 0.18em, and
 * `typo-overline`, which no stylesheet defines at all, so those heads rendered
 * as inherited type. They are all `MODAL_SECTION_HEAD` (`typo-eyebrow`) now -
 * the repo's canonical tracked-uppercase section head, added at Gate 0 for
 * exactly this reason and counting 361 hand-composed strings it was meant to
 * replace.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { GoalDetailProvider } from './goalDetail/context';
import { useGoalDetail } from './goalDetail/useGoalDetail';
import { LedgerLayout } from './goalDetail/variants/LedgerLayout';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  goalId: string | null;
  /** Opens the GoalEditorModal in edit mode for this goal. */
  onEdit: (goal: DevGoal) => void;
  /** Fallback goal object for goals NOT in the active-project store (e.g. the
   *  cross-project channel sidebar). Used when the store lookup misses. */
  goalFallback?: DevGoal | null;
}

export function GoalDetailDrawer({ isOpen, onClose, goalId, onEdit, goalFallback = null }: Props) {
  const model = useGoalDetail({ isOpen, goalId, onEdit, onClose, goalFallback });

  // The one early return, so no layout has to carry the guard.
  if (!model.goal) return null;

  return (
    <GoalDetailProvider model={model}>
      <LedgerLayout isOpen={isOpen} />
    </GoalDetailProvider>
  );
}
