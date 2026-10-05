// Pure helpers for the Switchboard variant: the summary counts, the switch's
// position per state, and the roving-focus step. No React, so they are tested
// directly and the components stay presentation only.

import type { DevServerState } from '@/lib/bindings/DevServerState';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { SERVER_TONE, canStart, canStop, type ServerTone } from '../../serverTone';

/** States in which a process holds the port (stopping still holds it until it exits). */
const HOLDS_PORT: ReadonlySet<DevServerState> = new Set(['running', 'starting', 'stopping', 'external']);

export interface SwitchboardSummary {
  total: number;
  running: number;
  starting: number;
  external: number;
  failed: number;
  /** Servers holding their port, in list order. */
  portHolders: DevServerView[];
}

export function summarize(servers: readonly DevServerView[]): SwitchboardSummary {
  const count = (state: DevServerState) => servers.filter((s) => s.state === state).length;
  return {
    total: servers.length,
    running: count('running'),
    starting: count('starting'),
    external: count('external'),
    failed: count('failed'),
    portHolders: servers.filter((s) => HOLDS_PORT.has(s.state)),
  };
}

/** Where the switch's thumb sits: on (holding the port), mid (in transit), off. */
export type SwitchPosition = 'on' | 'mid' | 'off';

export function switchPosition(state: DevServerState): SwitchPosition {
  if (state === 'stopping') return 'mid';
  if (state === 'running' || state === 'starting' || state === 'external') return 'on';
  return 'off';
}

/** The primary control is inert on the host server and on any state with nothing to toggle. */
export function isInert(server: Pick<DevServerView, 'state' | 'devPort'>, hostPort: number | null): boolean {
  if (hostPort != null && server.devPort === hostPort) return true;
  return !canStart(server.state) && !canStop(server.state);
}

export function toneOf(state: DevServerState): ServerTone {
  return SERVER_TONE[state].tone;
}

/**
 * The next row for a navigation key, or null when the key does not move focus.
 * Arrows stop at the ends rather than wrapping: a console you scan top to
 * bottom should not jump back to the top on one key too many.
 */
export function stepIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'PageDown':
      return Math.min(count - 1, index + 10);
    case 'PageUp':
      return Math.max(0, index - 10);
    default:
      return null;
  }
}

/** The keyboard's "open the context menu" chords: the Menu key and Shift+F10. */
export function isMenuChord(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}
