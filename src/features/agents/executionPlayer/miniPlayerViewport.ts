import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';

/** The player's width and the header strip that must stay reachable. */
const PLAYER_WIDTH = 360;
const HEADER_HEIGHT = 80;

/** The bounds the drag handler and a window resize both enforce. */
export function clampMiniPlayerPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(window.innerWidth - PLAYER_WIDTH, x)),
    y: Math.max(0, Math.min(window.innerHeight - HEADER_HEIGHT, y)),
  };
}

/**
 * Re-clamp a pinned player when the window shrinks. The position was clamped
 * only during a drag, so restoring a maximized window left a player placed at
 * innerWidth - 380 fully off-screen, its drag header unreachable for the session.
 */
export function useMiniPlayerViewportClamp(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onResize = () => {
      const { miniPlayerPosition: pos, setMiniPlayerPosition } = useAgentStore.getState();
      if (pos.x === -1) return; // not placed yet; the seeding effect owns it
      const next = clampMiniPlayerPosition(pos.x, pos.y);
      if (next.x !== pos.x || next.y !== pos.y) setMiniPlayerPosition(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled]);
}
