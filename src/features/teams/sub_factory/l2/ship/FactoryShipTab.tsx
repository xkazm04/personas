// The Ship tab — the milestone / convergence layer between the passport
// (scaffolding) and the KPI module (post-ship operation). WIRED: the Planner
// runs on live dev_milestones through useShipData (decisions in SQLite,
// derivations client-side), and unmet exit criteria dispatch Fleet sessions
// through the passport wall's machinery (ShipDispatch). The Ship strings are
// extracted into the `ship` i18n section across all 14 locales. Reference doc:
// docs/features/plugins/dev tools/ship.md.
import type { FactoryL2Data } from '../factoryL2Data';
import { ShipPlannerTab } from './ShipPlannerTab';

export function FactoryShipTab({ data }: { data: FactoryL2Data }) {
  return (
    <div data-testid="factory-ship-tab">
      <ShipPlannerTab data={data} />
    </div>
  );
}
