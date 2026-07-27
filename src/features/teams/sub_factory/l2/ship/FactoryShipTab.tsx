// The Ship tab host — PROTOTYPE SWITCHER (throwaway; deleted at consolidation
// per the /prototype workflow). Round 3: the round-2 fusion (Board) stays as
// baseline; two POLISHED directions answer "could I actually run my scope
// here?" after the round-2 critique (roadmap visuals poor, Later/Never
// unreadable):
//   • Horizon — editorial mission-brief: milestone cards, criteria as evidence
//               tiles, scope as full-width collapsible sections. Read-first.
//   • Planner — split-pane manager: vertical roadmap spine + workspace with
//               "In the cut" cards and an "Outside the cut" ledger whose
//               bucket cell is the triage control. Work-first.
import { useState } from 'react';

import { InkTabs } from '../../passport/passportInk';
import { ShipHorizonTab } from './ShipHorizonTab';
import { ShipPlannerTab } from './ShipPlannerTab';
import { ShipRoadmapBoard } from './ShipRoadmapBoard';

type ShipVariant = 'board' | 'horizon' | 'planner';

const VARIANTS: Array<{ id: ShipVariant; label: string; note: string }> = [
  { id: 'board', label: 'Board', note: 'round-2 fusion baseline — rail + kanban' },
  { id: 'horizon', label: 'Horizon', note: 'editorial brief — milestone cards, evidence tiles, full-width scope' },
  { id: 'planner', label: 'Planner', note: 'split-pane manager — roadmap spine + cut workspace + ledger' },
];

export function FactoryShipTab() {
  const [variant, setVariant] = useState<ShipVariant>('board');
  const note = VARIANTS.find((v) => v.id === variant)?.note ?? '';

  return (
    <div data-testid="factory-ship-tab">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <InkTabs tabs={VARIANTS} active={variant} onChange={setVariant} label="Prototype" />
        <span className="typo-caption text-foreground/35">{note} · mock data</span>
      </div>
      {variant === 'board' && <ShipRoadmapBoard />}
      {variant === 'horizon' && <ShipHorizonTab />}
      {variant === 'planner' && <ShipPlannerTab />}
    </div>
  );
}
