// The Ship tab host — PROTOTYPE SWITCHER (throwaway; deleted at consolidation
// per the /prototype workflow). Round 4: Planner's layout + Board's row theme
// fused into the baseline (Horizon and the old Board retired); two new
// variants explore MANUAL MILESTONE COMPOSITION from personas primitives
// (features bind, goals frame, contexts derive):
//   • Library — bottom-up: shop the scanned inventory into the cut, watch the
//               derived context footprint (health + KPI gaps) grow.
//   • Outline — top-down: state the promise, decompose into deliverables,
//               bind scan-suggested features under each.
import { useState } from 'react';

import { InkTabs } from '../../passport/passportInk';
import { ShipComposeLibraryTab } from './ShipComposeLibraryTab';
import { ShipComposeOutlineTab } from './ShipComposeOutlineTab';
import { ShipPlannerTab } from './ShipPlannerTab';

type ShipVariant = 'planner' | 'library' | 'outline';

const VARIANTS: Array<{ id: ShipVariant; label: string; note: string }> = [
  { id: 'planner', label: 'Planner', note: 'baseline — spine + one ledger language for the whole scope' },
  { id: 'library', label: 'Compose · Library', note: 'bottom-up — shop features into the cut, contexts derive' },
  { id: 'outline', label: 'Compose · Outline', note: 'top-down — promise → deliverables → bind suggestions' },
];

export function FactoryShipTab() {
  const [variant, setVariant] = useState<ShipVariant>('planner');
  const note = VARIANTS.find((v) => v.id === variant)?.note ?? '';

  return (
    <div data-testid="factory-ship-tab">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <InkTabs tabs={VARIANTS} active={variant} onChange={setVariant} label="Prototype" />
        <span className="typo-caption text-foreground/35">{note} · mock data</span>
      </div>
      {variant === 'planner' && <ShipPlannerTab />}
      {variant === 'library' && <ShipComposeLibraryTab />}
      {variant === 'outline' && <ShipComposeOutlineTab />}
    </div>
  );
}
