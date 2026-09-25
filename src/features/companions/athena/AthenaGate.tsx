// Mount these children only while Athena is switched on.
//
// The switch has to UNMOUNT her, not hide her: her orb layer, chat panel and
// guide layer each open subscriptions, hold timers and answer events, so a
// hidden one is still a running one. Unmounting is also what makes switching
// her back on cheap - the pages stay reachable, so the operator can always
// find the control that returns her.
import type { ReactNode } from 'react';

import { useAthenaEnabled } from '../status/useAthenaEnabled';

export default function AthenaGate({ children }: { children: ReactNode }) {
  const { enabled } = useAthenaEnabled();
  return enabled ? <>{children}</> : null;
}
