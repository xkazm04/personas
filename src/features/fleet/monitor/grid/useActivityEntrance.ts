// useActivityEntrance — the Activity surface's COLD-OPEN choreography, as four
// coarse beats: chrome, tiles, rail, usage.
//
// TWO MECHANISMS, TWO JOBS — do not merge them.
//   • `useStagedMount` (rAF, 3 stages) decides when a heavy subtree MOUNTS.
//   • This hook decides when a region is ADMITTED to the frame, which is when
//     it is SEEN. Inside an admitted region, a list of rows or tiles plays its
//     own per-item entrance through `useProgressiveReveal` + `RevealItem`;
//     this hook never touches an item.
//
// THE KEY IS THE COLD OPEN, NOT THE DATA. `useBuildUp` restarts whenever its
// key changes, so a key that encoded fleet contents would replay the whole
// entrance every time a session appeared. The key here is one of exactly two
// literals — 'cold' or 'warm' — chosen ONCE per mount from a module flag, held
// in a ref, and never recomputed. No session, count, filter, workspace or
// timestamp reaches it, so no arriving datum can restart or stall the beats.
//
// ONCE PER APP SESSION, the same rule `useStagedMount` keeps: after the beats
// have played out once, the flag is set and every later mount opens complete.
// The Monitor no longer unmounts on close (74e055512), so in practice the
// second open of a session is the same mount and is instant for that reason
// too — the flag is what covers a genuine remount.
//
// REDUCED MOTION: `useBuildUp` returns `total` immediately when motion is off
// OR when `stepMs` is 0, and both paths are exercised here (warm passes 0).

import { useEffect, useRef } from 'react';
import { useBuildUp } from '@/hooks/utility/interaction/useBuildUp';

/** The beats, in order. `useBuildUp` counts from 1, so chrome is always on. */
export const BEAT = { chrome: 1, tiles: 2, rail: 3, usage: 4 } as const;

/** How many beats the entrance has. */
export const TOTAL_BEATS = 4;

/**
 * Milliseconds between beats.
 *
 * 110ms, giving a 330ms entrance from chrome to usage. Three constraints pick
 * it: a beat needs its own paint, so it must clear two 60Hz frames (33ms);
 * two events closer than ~80ms fuse into one and the sequence stops reading as
 * a sequence; and the whole thing must land inside the ~400ms an interface
 * transition can take before it reads as a wait rather than a move. The Guide
 * sheet's 380-1500ms is built for a scaffold that takes a minute — an overlay
 * somebody opened to look at something gets 330ms.
 */
export const BEAT_MS = 110;

let entrancePlayed = false;

export interface ActivityEntrance {
  /** The current beat, 1..TOTAL_BEATS. Compare against {@link BEAT}. */
  beat: number;
  /** True when this mount opened warm — nothing animates, everything is in. */
  warm: boolean;
}

/**
 * The cold-open beats. Returns `TOTAL_BEATS` immediately on a warm open and
 * under reduced motion.
 */
export function useActivityEntrance(): ActivityEntrance {
  // Captured at the FIRST render of this mount and never recomputed: the key
  // cannot change while the surface is alive, so nothing that arrives later
  // can restart the clock.
  const warmRef = useRef(entrancePlayed);
  const warm = warmRef.current;
  const beat = useBuildUp(warm ? 'warm' : 'cold', TOTAL_BEATS, warm ? 0 : BEAT_MS);

  useEffect(() => {
    if (beat >= TOTAL_BEATS) entrancePlayed = true;
  }, [beat]);

  return { beat, warm };
}

/** Test hatch — the once-per-session flag is module state, like `useStagedMount`'s. */
export function _resetActivityEntranceForTests(): void {
  entrancePlayed = false;
}
