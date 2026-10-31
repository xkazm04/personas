/**
 * The hooks a Blueprint surface uses to share the window's bp follower (lens/bpFollower.ts, spark roadmap S6): its
 * state, and counting the surface toward bp presence while it is on screen. A shared place only moves Personas while a
 * Blueprint surface is visible, so it never pops the drawing sheet over another Personas view.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { BpFollower, FollowerState } from './bpFollower';

const NO_SUB = () => () => {};
const NO_STATE = () => null;

/** The follower's state, re-rendering on change; null without a follower (the fixture, a test). */
export function useFollowerState(f: BpFollower | undefined): FollowerState | null {
  return useSyncExternalStore(f ? f.subscribe : NO_SUB, f ? f.getState : NO_STATE);
}

/** Count this surface toward bp presence while it is mounted, and as visible while `visible` holds. */
export function useBpFollowSurface(f: BpFollower | undefined, visible: boolean): void {
  const handle = useRef<ReturnType<BpFollower['surface']> | null>(null);
  useEffect(() => {
    if (!f) return;
    const h = f.surface(false);
    handle.current = h;
    return () => { handle.current = null; h.close(); };
  }, [f]);
  useEffect(() => { handle.current?.setVisible(visible); }, [f, visible]);
}
