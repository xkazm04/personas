/**
 * Positioning for surfaces that dock against the orb.
 *
 * Two bubbles now float above Athena — the decision surface and the unread
 * message — and both need the same three answers: where is the orb right now,
 * which side has room, and what CSS puts a panel just above it. Deriving that
 * twice is how they drift apart by a few pixels and start looking like two
 * different components.
 *
 * The anchor prefers the orb's last reported pixel target (set as it drags or
 * docks) and falls back to the persisted fraction, so a bubble has a home even
 * before the orb has reported a position this session.
 */

import type { CSSProperties } from 'react';
import { BUBBLE_GAP, ORB_SIZE } from './athenaOrbGeometry';

export interface OrbDock {
  /** Orb top-left in px. */
  anchorLeft: number;
  anchorTop: number;
  /** Orb sits on the left half — bubbles align to its left edge. */
  dockedLeft: boolean;
  /** Absolute placement for a bubble sitting above the orb. */
  pos: CSSProperties;
  /** Placement for the tail/handle that points back down at the orb. */
  handleSide: CSSProperties;
}

export function orbDock(
  orbTarget: { left: number; top: number } | null | undefined,
  orbPos: { x: number; y: number },
): OrbDock {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const anchorLeft = orbTarget?.left ?? orbPos.x * Math.max(vw - ORB_SIZE, 0);
  const anchorTop = orbTarget?.top ?? orbPos.y * Math.max(vh - ORB_SIZE, 0);
  const dockedLeft = anchorLeft + ORB_SIZE / 2 < vw / 2;

  return {
    anchorLeft,
    anchorTop,
    dockedLeft,
    pos: dockedLeft
      ? { left: anchorLeft, bottom: vh - anchorTop + BUBBLE_GAP }
      : { right: vw - anchorLeft - ORB_SIZE, bottom: vh - anchorTop + BUBBLE_GAP },
    handleSide: dockedLeft ? { left: 14 } : { right: 14 },
  };
}
