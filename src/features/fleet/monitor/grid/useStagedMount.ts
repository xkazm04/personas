// useStagedMount — paint the board's chrome before its content, once.
//
// THE COLD OPEN, measured by reading the tree rather than a profiler: the
// Monitor is a lazy chunk, and on its first mount `FleetGridView` committed
// everything in ONE render — the card, every column's tiles, and the rail,
// whose three feeds (the unified triage queue, the dispatch backlog, the
// 600-row merged channel projection) are the most expensive hooks on the
// surface. Nothing enforced a delay; the delay WAS the commit. The operator
// saw the overlay's fallback ghost, then a long blank, then everything at
// once.
//
// So the first paint is staged: stage 0 is chrome only (header, usage strip,
// column headers, geometry-matched ghost rows, an empty rail of the right
// width); each following animation frame admits the next layer — the tiles,
// then the rail. The chrome lands in the first frame, and the operator
// watches the board fill rather than waiting for it.
//
// ONCE PER APP SESSION. After the first full paint the board is warm (every
// feed it reads is a module cache or a live store), and a warm remount would
// only be slowed by staging — a two-frame ghost on a surface that could have
// painted complete. The flag is module state on purpose, like every other
// warm cache on this surface: it must outlive the Monitor's unmount.

import { useEffect, useState } from 'react';

/** Stages the board climbs on its first paint; `FINAL_STAGE` means "all in". */
export const FINAL_STAGE = 2;

let paintedOnce = false;

/**
 * The current mount stage, 0..FINAL_STAGE. Returns FINAL_STAGE immediately
 * once the board has completed a paint in this app session.
 */
export function useStagedMount(): number {
  const [stage, setStage] = useState(() => (paintedOnce ? FINAL_STAGE : 0));

  useEffect(() => {
    if (stage >= FINAL_STAGE) {
      paintedOnce = true;
      return;
    }
    // One frame per stage: rAF fires after the current commit has painted, so
    // the layer below is on screen before the next one is asked for.
    const id = requestAnimationFrame(() => setStage((s) => Math.min(FINAL_STAGE, s + 1)));
    return () => cancelAnimationFrame(id);
  }, [stage]);

  return stage;
}

/** Test hatch — the once-per-session flag is module state. */
export function _resetStagedMountForTests(): void {
  paintedOnce = false;
}
