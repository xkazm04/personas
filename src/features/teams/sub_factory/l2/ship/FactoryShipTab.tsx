// The Ship tab host — PROTOTYPE SWITCHER (throwaway; deleted at consolidation
// per the /prototype workflow). Three directional variants of the milestone /
// convergence layer, all reading the same mock milestone from shipModel:
//   • Runway    — journey: a flightpath from Cut to Ship, criteria as gates,
//                 one convergent "between you and ship" list.
//   • Cut board — triage: Core/Later/Never buckets, the cut as the primary
//                 (working) interaction, post-cut proposals in an uncut inbox.
//   • Go/No-Go  — certification: a launch-poll board, stations vote from
//                 derived evidence, Certify arms only on all-GO.
import { useState } from 'react';

import { InkTabs } from '../../passport/passportInk';
import { ShipCutBoardTab } from './ShipCutBoardTab';
import { ShipGoNoGoTab } from './ShipGoNoGoTab';
import { ShipRunwayTab } from './ShipRunwayTab';

type ShipVariant = 'runway' | 'cutboard' | 'gonogo';

const VARIANTS: Array<{ id: ShipVariant; label: string; note: string }> = [
  { id: 'runway', label: 'Runway', note: 'journey — gates on a flightpath, one convergent remaining-work list' },
  { id: 'cutboard', label: 'Cut board', note: 'triage — Core/Later/Never buckets, the cut is the interaction' },
  { id: 'gonogo', label: 'Go/No-Go', note: 'certification — launch-poll stations voting from derived evidence' },
];

export function FactoryShipTab() {
  const [variant, setVariant] = useState<ShipVariant>('runway');
  const note = VARIANTS.find((v) => v.id === variant)?.note ?? '';

  return (
    <div data-testid="factory-ship-tab">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <InkTabs tabs={VARIANTS} active={variant} onChange={setVariant} label="Prototype" />
        <span className="typo-caption text-foreground/35">{note} · mock data</span>
      </div>
      {variant === 'runway' && <ShipRunwayTab />}
      {variant === 'cutboard' && <ShipCutBoardTab />}
      {variant === 'gonogo' && <ShipGoNoGoTab />}
    </div>
  );
}
