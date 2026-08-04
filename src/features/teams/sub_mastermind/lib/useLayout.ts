// React bindings for the durable layout store. These replace the one-shot
// `useState(loadGroups)` initializers the canvas used to open with: a snapshot
// taken at mount can only ever be right until someone else writes, and the
// canvas now has a second writer (Athena composing objects out of band). With
// `useSyncExternalStore` there is exactly ONE copy of the layout — the store's —
// so a programmatic write paints without a remount, and the next user commit is
// built from the post-write array instead of clobbering it.
import { useSyncExternalStore } from 'react';

import {
  athenaPanelsSnapshot,
  countAthenaObjects,
  groupsSnapshot,
  hiddenSnapshot,
  linksSnapshot,
  notesSnapshot,
  positionsSnapshot,
  subscribeLayout,
  type AthenaPanel,
  type PositionMap,
} from './layoutStore';
import type { CanvasNote, GroupRect, UserLink } from './types';

export const useLayoutPositions = (): PositionMap =>
  useSyncExternalStore(subscribeLayout, positionsSnapshot);

export const useLayoutGroups = (): readonly GroupRect[] =>
  useSyncExternalStore(subscribeLayout, groupsSnapshot);

export const useLayoutLinks = (): readonly UserLink[] =>
  useSyncExternalStore(subscribeLayout, linksSnapshot);

export const useLayoutNotes = (): readonly CanvasNote[] =>
  useSyncExternalStore(subscribeLayout, notesSnapshot);

export const useLayoutHidden = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribeLayout, hiddenSnapshot);

export const useAthenaPanels = (): Readonly<Record<string, AthenaPanel>> =>
  useSyncExternalStore(subscribeLayout, athenaPanelsSnapshot);

/** How many objects on the board Athena authored (a number, so the snapshot is
 *  stable by value). Drives the revert affordance. */
export const useAthenaObjectCount = (): number =>
  useSyncExternalStore(subscribeLayout, countAthenaObjects);
