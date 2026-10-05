/**
 * GoalDetailDrawer - the focused detail surface for a single goal.
 *
 * Composes the goal's hybrid progress nudge (resolve_goal_progress ->
 * accept/edit; never silent), the unified checklist (ad-hoc items, sub-goals and
 * linked team-assignment steps, with inline intervention on awaiting_review),
 * the verification gate, and the live activity feed (dev_goal_signals, incl. the
 * team_* signals the orchestrator writes).
 *
 * 2026-10-05 - SHELL ONLY, AND FOUR LAYOUTS.
 *
 * This file was 774 lines: store bindings, six parallel reads, 14 state slots,
 * 20 handlers and a seven-section render in one function. That is also why it
 * could only ever have one layout, and the owner's note was about the layout:
 * "composed as one large column instead of spreading to width and using size to
 * compose sections visually better and with more clarity".
 *
 * So the data moved to `goalDetail/useGoalDetail` behind a context, the sections
 * became blocks in `goalDetail/blocks/`, and a LAYOUT is now a small file that
 * arranges blocks and chooses how loudly each one speaks. Three alternatives
 * ship beside the original, each taking a different position on the same brief:
 *
 *   COLUMN   the shipped baseline, kept so the others are judged against the
 *            real thing rather than a memory of it
 *   LEDGER   the sections are NOT peers - 2:1 split, work left, consult rail
 *            right, three heading tiers
 *   DOSSIER  only the DECISION ranks - a full-bleed band carries it, then three
 *            equal columns with no hierarchy at all
 *   BRIEF    spreading to width is not always better - the reading column stays
 *            at a sane measure and the width buys a one-at-a-time shelf, so the
 *            surface has a constant height
 *
 * The switcher is dev-only and the default is COLUMN, so nothing changes for a
 * user until the owner picks. The choice lasts for the session.
 */
import { useState, type ReactElement } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { Segmented } from '@/features/shared/components/kit';
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { GoalDetailProvider } from './goalDetail/context';
import { useGoalDetail } from './goalDetail/useGoalDetail';
import { ColumnLayout, COLUMN_WIDTH } from './goalDetail/variants/ColumnLayout';
import { LedgerLayout, LEDGER_WIDTH } from './goalDetail/variants/LedgerLayout';
import { DossierLayout, DOSSIER_WIDTH } from './goalDetail/variants/DossierLayout';
import { BriefLayout, BRIEF_WIDTH } from './goalDetail/variants/BriefLayout';

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

type VariantId = 'column' | 'ledger' | 'dossier' | 'brief';

const VARIANTS: Record<VariantId, { width: string; Layout: () => ReactElement | null; label: string }> = {
  column: { width: COLUMN_WIDTH, Layout: ColumnLayout, label: 'Column' },
  ledger: { width: LEDGER_WIDTH, Layout: LedgerLayout, label: 'Ledger' },
  dossier: { width: DOSSIER_WIDTH, Layout: DossierLayout, label: 'Dossier' },
  brief: { width: BRIEF_WIDTH, Layout: BriefLayout, label: 'Brief' },
};

/**
 * Declared once, here, instead of as an `import.meta.env.DEV` gate inside the
 * JSX. A build-flag decision taken at the point of rendering cannot be
 * enumerated or reviewed (`inline-dev-build-gate`); a named module constant can
 * be grepped. This is not a `NavGates` entry because it gates no route - it is a
 * comparison affordance inside one modal.
 */
const SHOW_LAYOUT_SWITCHER = import.meta.env.DEV;

/** The layout chosen for THIS session. Deliberately not persisted: the switcher
 *  exists to pick a winner, and inventing a Web Storage call for a temporary
 *  prototype toggle would add a storage site the golden path would then have to
 *  route somewhere. It resets to the shipped baseline on reload. */
const DEFAULT_VARIANT: VariantId = 'column';

export function GoalDetailDrawer({ isOpen, onClose, goalId, onEdit, goalFallback = null }: Props) {
  const model = useGoalDetail({ isOpen, goalId, onEdit, onClose, goalFallback });
  const [variant, setVariant] = useState<VariantId>(DEFAULT_VARIANT);

  // Every early return lives here, so no layout has to carry the guard.
  if (!model.goal) return null;
  const { width, Layout } = VARIANTS[variant];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="goal-detail-title"
      maxWidthClass={width}
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4 max-h-[88vh] overflow-y-auto"
    >
      <GoalDetailProvider model={model}>
        <Layout />
        {SHOW_LAYOUT_SWITCHER && (
          // Dev-only, and deliberately at the BOTTOM: a layout chooser above the
          // content would itself become part of the composition being judged.
          <div className="mt-5 pt-3 border-t border-primary/10 flex items-center gap-2">
            <span className="typo-caption text-foreground">Layout</span>
            <Segmented
              label="Goal detail layout"
              value={variant}
              onChange={setVariant}
              options={(Object.keys(VARIANTS) as VariantId[]).map((v) => ({ v, label: VARIANTS[v].label }))}
            />
          </div>
        )}
      </GoalDetailProvider>
    </BaseModal>
  );
}
