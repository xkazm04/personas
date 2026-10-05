// Synthetic tapes for the Activity desk's rail rows (monitorRailSurfaces.tsx).
// Fixture CODE, no personal data. Both reuse the Board's tapes
// (monitorBoardTapes.mjs) rather than inventing a second fleet:
//
//   monitor/rail        the Board's simulation shell: the Monitor's simulated
//                       rail fills the DecisionDock's Reviews tab. (The real
//                       review queue cannot be shot from a tape today: under
//                       StrictMode `useMonitorData`'s `mounted` ref strands
//                       every page read before it reaches state - the same
//                       defect the Board surface works around for its badges.)
//   monitor/rail/kinds  the Board's real-shaped fleet, so the fixture rows can
//                       resolve their personas' faces from the roster.

import { monitorBoardTapes } from './monitorBoardTapes.mjs';

export function monitorRailTapes({ RECORDED_AT }) {
  const board = monitorBoardTapes({ RECORDED_AT }).builders;
  const as = (module, from, note) => () => ({ ...board[from](), module, note });
  return {
    builders: {
      'monitor/rail': as('monitor/rail', 'monitor/board/sim', 'Synthetic shell only: the rail is the test build simulation.'),
      'monitor/rail/kinds': as('monitor/rail/kinds', 'monitor/board', 'Synthetic: the Board fleet roster, for the fixture rows\' faces.'),
    },
  };
}
