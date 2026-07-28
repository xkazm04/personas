// The Ship tab — the milestone / convergence layer between the passport
// (scaffolding) and the KPI module (post-ship operation). WIRED: the Planner
// runs on live dev_milestones through useShipData (decisions in SQLite,
// derivations client-side), and unmet exit criteria dispatch Fleet sessions
// through the passport wall's machinery (ShipDispatch). Remaining before
// ship: i18n extraction of the Ship strings.
import type { FactoryL2Data } from '../factoryL2Data';
import { ShipPlannerTab } from './ShipPlannerTab';

export function FactoryShipTab({ data }: { data: FactoryL2Data }) {
  return (
    <div data-testid="factory-ship-tab">
      <ShipPlannerTab data={data} />
    </div>
  );
}
