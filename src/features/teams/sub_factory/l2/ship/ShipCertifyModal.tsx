// The COMMIT half of certification, and only that.
//
// The criteria moved out to `ShipCriteria.tsx` and now render inline in the
// planner, beside the cut they are measured against (operator ruling,
// 2026-08-25). This modal used to carry both, which meant the only way to READ
// where a milestone stood was to open the dialog that also COMMITS it — a
// reading surface behind an action gate.
//
// What is left is the decision: the question, the standing verdict in one line,
// and the button. The gate itself is unchanged — `shipVerdict` over the criteria
// registry, and nothing else.
import { Check, Rocket } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../passport/passportInk';
import { shipVerdict, type ShipMilestoneVM } from './shipModel';

export function ShipCertifyModal({ vm, onCertify, onClose }: {
  vm: ShipMilestoneVM;
  /** Advance the lifecycle: planned → active (cut), active → shipped. */
  onCertify: () => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const verdict = shipVerdict(vm.criteria);
  const cutting = vm.status === 'planned';
  // Cutting FREEZES the scope (it stamps `cut_at`, which is what makes
  // `added_after_cut` mean anything); shipping is the gated act. Blocking a cut
  // on the criteria would be backwards — the criteria are measured against the
  // cut, so they cannot be a precondition for making one.
  const blocked = !cutting && verdict !== 'go';

  return (
    <>
      <BaseModal isOpen onClose={onClose} titleId="ship-certify-title" portal maxWidthClass="max-w-2xl" staggerChildren={false}>
        <div data-testid="ship-certify-modal">
          <h2 id="ship-certify-title" className="typo-title-lg mb-1">
            {cutting ? tx(t.ship.certify_cut_title, { name: vm.name }) : tx(t.ship.certify_ship_title, { name: vm.name })}
          </h2>
          <p className="typo-caption mb-4">
            {cutting ? t.ship.certify_cut_intro : t.ship.certify_ship_intro}
          </p>

          {/* The standing verdict, in one line. The evidence for it is on the
              page behind this dialog; repeating it here is what made the modal
              the only place a milestone could be read. */}
          <p className="typo-caption mb-4" style={{ color: blocked ? INK.amber : undefined }}>
            {tx(t.ship.certify_criteria_summary, {
              met: vm.criteria.filter((c) => c.state === 'go').length,
              total: vm.criteria.length,
            })}
          </p>

          <div className="flex items-center justify-between gap-3">
            <p className="typo-caption min-w-0" style={{ color: blocked ? INK.amber : undefined }}>
              {blocked ? t.ship.certify_blocked_tooltip : cutting ? t.ship.certify_cut_tooltip : t.ship.certify_ship_tooltip}
            </p>
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-interactive typo-caption text-foreground/60 hover:text-foreground transition-colors focus-ring"
              >
                {t.common.cancel}
              </button>
              <AsyncButton
                disabled={blocked}
                onClick={() => { onCertify(); onClose(); }}
                icon={cutting ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Rocket className="w-3.5 h-3.5" aria-hidden />}
                data-testid="ship-certify-confirm"
              >
                {cutting ? t.ship.certify_cut : t.ship.certify_ship}
              </AsyncButton>
            </span>
          </div>
        </div>
      </BaseModal>

    </>
  );
}
