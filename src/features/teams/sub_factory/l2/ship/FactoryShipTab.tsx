// The Ship tab — the milestone / convergence layer between the passport
// (scaffolding) and the KPI module (post-ship operation). Round-5 shape after
// the /prototype loop converged: the Planner is THE surface (roadmap spine +
// one ledger language for the scope), and milestone composition is a
// milestone-scoped mode opened from it (ShipMilestoneComposer — context tree
// left, cut right). The prototype switcher is gone; Compose·Outline lost.
//
// TODO(prototype, 2026-07-28): still on shipModel mocks — before ship this
// needs the real data layer (dev_milestones + milestone_id joins), i18n
// extraction of all strings, and Fleet dispatch on exit-criteria gaps.
import { ShipPlannerTab } from './ShipPlannerTab';

export function FactoryShipTab() {
  return (
    <div data-testid="factory-ship-tab">
      <ShipPlannerTab />
    </div>
  );
}
