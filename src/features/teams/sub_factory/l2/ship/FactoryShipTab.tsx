// The Ship tab — the milestone / convergence layer between the passport
// (scaffolding) and the KPI module (post-ship operation). WIRED: the Planner
// runs on live dev_milestones through useShipData (decisions in SQLite,
// derivations client-side). Remaining before ship: i18n extraction of the
// Ship strings, and Fleet dispatch on unmet exit criteria (see the design
// discussion — criteria evaluation is derived, resolution is dispatched).
import type { FactoryL2Data } from '../factoryL2Data';
import { ShipPlannerTab } from './ShipPlannerTab';

export function FactoryShipTab({ data }: { data: FactoryL2Data }) {
  return (
    <div data-testid="factory-ship-tab">
      <ShipPlannerTab data={data} />
    </div>
  );
}
