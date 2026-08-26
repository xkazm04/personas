// The COMMIT half of certification — and by now, nothing but a confirm.
//
// This file has shed two jobs and is better for both. The exit criteria moved
// out to `ShipCriteriaPanel.tsx` and render inline beside the cut they are
// measured against, because the only complete reading of a milestone used to be
// reachable through the dialog that also COMMITS it — a reading surface behind
// an action gate. And the blocked state moved to the control bar's button,
// because a dialog whose only message is "no" is a dead end when the evidence
// for the "no" is already on the page behind it. You cannot open this while
// shipping is refused; cutting is never refused.
//
// What is left is a question and two buttons, which is exactly the shared
// `ConfirmDialog` (24 call sites). It already solves the part hand-rolling gets
// wrong: `onConfirm` may return a promise, and while it is pending BOTH buttons
// disable and backdrop/Escape dismissal is ignored, so a lifecycle transition
// cannot be fired twice by a double-click or an impatient retry. The version
// this replaces reimplemented the panel, the button pair and the spacing — and
// did not reimplement that guard.
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';

import type { ShipMilestoneVM } from './shipModel';

export function ShipCertifyModal({ vm, onCertify, onClose }: {
  vm: ShipMilestoneVM;
  /** Advance the lifecycle: planned → active (cut), active → shipped. */
  onCertify: () => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  // Cutting FREEZES the scope (it stamps `cut_at`, which is what makes
  // `added_after_cut` mean anything); shipping is the gated act. Blocking a cut
  // on the criteria would be backwards — the criteria are measured AGAINST the
  // cut, so they cannot be a precondition for making one.
  const cutting = vm.status === 'planned';
  const met = vm.criteria.filter((c) => c.state === 'go').length;

  return (
    <ConfirmDialog
      title={cutting
        ? tx(t.ship.certify_cut_title, { name: vm.name })
        : tx(t.ship.certify_ship_title, { name: vm.name })}
      // One line of standing verdict, no more. The evidence behind it is on the
      // page under this dialog.
      body={`${cutting ? t.ship.certify_cut_intro : t.ship.certify_ship_intro} ${tx(t.ship.certify_criteria_summary, { met, total: vm.criteria.length })}`}
      confirmLabel={cutting ? t.ship.certify_cut : t.ship.certify_ship}
      onConfirm={() => { onCertify(); onClose(); }}
      onCancel={onClose}
    />
  );
}
