// THE USAGE SLOT — the lazy boundary the subscription plates live behind.
//
// Same reason as `DeskSlot`: the weight is `useUsageFeed` (the Claude account
// snapshot, the CLI reader, the simulated plans, the switch/remove confirm),
// and a hook cannot be lazily imported. Moving the CALL behind a component
// boundary makes the supply column's heaviest plate splittable, and the
// confirm dialog it owns comes with it rather than being hoisted to the root.
//
// It is the last of the four beats because it is the one fact on the surface
// the operator is never waiting on: the fleet's state is the board, and a
// subscription window is the thing you check, not the thing you came for.

import { PlanPlates } from './PlanPlates';
import { useUsageFeed } from '../useUsageFeed';

export function UsageSlot({ simulating, warm = false }: { simulating: boolean; warm?: boolean }) {
  const usage = useUsageFeed(simulating);
  return (
    <>
      <PlanPlates usage={usage} revealEnabled={!warm} />
      {usage.dialog}
    </>
  );
}

export default UsageSlot;
