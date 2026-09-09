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

/** The two frames every recipe is judged in. */
export const BOARD_FRAMES: Array<{ level: 0 | 1; focus: WorldFocus }> = [
  { level: 0, focus: { level: 0, project: null, dim: null } },
  { level: 1, focus: { level: 1, project: 'personas', dim: null } },
];
