// The Ship tab host — PROTOTYPE (mock data; the /prototype loop is live).
// Round 2 fused the three round-1 directions into one: ShipRoadmapBoard =
// the Cut board's design + status kanban (base) with Runway's milestone rail
// fused in as roadmap navigation. Go/No-Go was killed. New variants, if any,
// get re-added here behind an InkTabs switcher.
import { ShipRoadmapBoard } from './ShipRoadmapBoard';

export function FactoryShipTab() {
  return (
    <div data-testid="factory-ship-tab">
      <ShipRoadmapBoard />
    </div>
  );
}
