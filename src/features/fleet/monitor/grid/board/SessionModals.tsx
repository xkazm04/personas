// SessionModals — the two surfaces behind a session tile.
//
// Both mount only when a tile is clicked, and the terminal one drags xterm
// along with it — neither belongs in the board's opening commit. A null
// Suspense fallback is right here: the trigger was a click on a tile, the
// modal's own shell paints as soon as the chunk lands, and there is no chrome
// to hold in between.
//
// Each is held as the SESSION rather than as its id. The registry patches rows
// underneath an open modal on every state event, and an id re-resolved per
// render would swap the pane's subject mid-read. The terminal is keyed on
// `session.id`, which does not change.

import { Suspense } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import type { FleetSession } from '@/lib/bindings/FleetSession';

const FleetTerminalModal = lazyRetry(() => import('../FleetTerminalModal'));
const SessionRecapModal = lazyRetry(() => import('../SessionRecapModal'));

export function SessionModals({
  terminal, recap, onCloseTerminal, onCloseRecap,
}: {
  terminal: FleetSession | null;
  /** The CHEAP read of a session — it mounts no xterm, so it can be opened on
   *  any tile of a 200-session board without costing a subscription. */
  recap: FleetSession | null;
  onCloseTerminal: () => void;
  onCloseRecap: () => void;
}) {
  return (
    <>
      {terminal && (
        <Suspense fallback={null}>
          <FleetTerminalModal session={terminal} onClose={onCloseTerminal} />
        </Suspense>
      )}
      {recap && (
        <Suspense fallback={null}>
          <SessionRecapModal session={recap} onClose={onCloseRecap} />
        </Suspense>
      )}
    </>
  );
}

export default SessionModals;
