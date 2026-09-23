// The fused instrument: the registry galaxy flown with the round-3 contest
// HUD. The field is the product's own engine (`../engine/GalaxyEngine`) in
// its `fused` style profile; over it, an altitude timeline with the nested
// list on the left, the named decisions at the top right, and two heavy
// instruments switched from the keyboard as MODES, never stacked: the
// bezel lens (the registry engraved on a dial rim that re-engraves per
// altitude), the cross-section dock (folded to what needs care at desktop
// width, spread on a wide monitor), or none, the galaxy alone.
//
// Promotion of the contest winner council-hud-r2-r3 (owner-chosen
// 2026-09-23). The visual contract is the winner's captured style contract
// at `.claude/council-reference/style-contract/` (machine-local); every
// build of this tree is checked against it to zero deviations, and the
// plan is `docs/design/promotions/2026-09-23-council-hud-and-cadastre.md`.
//
// This is the WP0 stub: it takes the same slot and props as `GalaxyStage`,
// so the page dispatches on the variant and nothing else, and it says so on
// screen rather than drawing a guess.
import type { ReactNode } from 'react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

export function FusedStage({ bench }: { bench?: ReactNode }) {
  const { t } = useTranslation();
  const v = t.council.variant;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-role="fused-stage" data-testid="council-fused-stage">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <ScenarioEmptyState title={v.fused_pending_title} subtitle={v.fused_pending_subtitle} />
      </div>
      {bench}
    </div>
  );
}

export default FusedStage;
