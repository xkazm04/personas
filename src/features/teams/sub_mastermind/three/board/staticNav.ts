// A frozen WorldNav for rendering a scene at ONE fixed layer with nothing
// wired to react. The board mounts every recipe this way: the camera lands
// on the pose for `focus` and stays there, and clicks in the scene go nowhere
// because the board's own cell click is the interaction that matters.
import type { WorldNav } from '../useWorldNav';
import { initialWorldState, type WorldFocus } from '../worldModel';

const noop = () => {};

export function staticNav(focus: WorldFocus): WorldNav {
  return {
    state: { ...initialWorldState(), focus },
    dispatch: noop,
    openProject: noop,
    openDim: noop,
    up: noop,
    home: noop,
    hover: noop,
    runAthena: noop,
  };
}

/** The project a board's L1 frame opens: Brainiac, because it is the
 *  hand-authored project with the FULL status range — an alert, two risks,
 *  absents and solids. A healthy project shows only green and blue, which
 *  hides exactly the colours a direction has to get right (and made "only
 *  trouble glows" render nothing glowing on board 2's first pass). */
export const BOARD_L1_PROJECT = 'brainiac';

/** The focus a board frame is judged at. */
export function frameFocus(level: 0 | 1): WorldFocus {
  return level === 0 ? { level: 0, project: null, dim: null } : { level: 1, project: BOARD_L1_PROJECT, dim: null };
}
