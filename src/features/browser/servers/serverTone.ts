// The ONE status vocabulary for a dev server. Every Server control variant and
// the Fleet Monitor bay resolve a `DevServerState` here, so "running" cannot be
// green on one surface and the theme primary on another. Tones match the
// Monitor's annunciator (`fleet/monitor/grid/prototype/entry-e/tone.ts`):
// running is the theme primary, like every other live thing in the app.

import type { DevServerState } from '@/lib/bindings/DevServerState';

export type ServerTone = 'run' | 'warn' | 'err' | 'info' | 'off';

export interface ServerToneSpec {
  tone: ServerTone;
  /** Whether the state is worth motion (a gentle pulse), not just colour. */
  pulse: boolean;
}

export const SERVER_TONE: Record<DevServerState, ServerToneSpec> = {
  running: { tone: 'run', pulse: true },
  starting: { tone: 'run', pulse: false },
  stopping: { tone: 'warn', pulse: false },
  external: { tone: 'info', pulse: false },
  failed: { tone: 'err', pulse: false },
  scanning: { tone: 'info', pulse: true },
  stopped: { tone: 'off', pulse: false },
  unconfigured: { tone: 'off', pulse: false },
};

/** Text colour token per tone. */
export const TONE_TEXT: Record<ServerTone, string> = {
  run: 'text-primary',
  warn: 'text-status-warning',
  err: 'text-status-error',
  info: 'text-status-info',
  off: 'text-foreground',
};

/** Background colour token per tone (lamps, bars, pins). */
export const TONE_BG: Record<ServerTone, string> = {
  run: 'bg-primary',
  warn: 'bg-status-warning',
  err: 'bg-status-error',
  info: 'bg-status-info',
  off: 'bg-foreground/30',
};

/** A process is holding the port: ours (running/starting) or someone else's. */
export function isLive(state: DevServerState): boolean {
  return state === 'running' || state === 'starting' || state === 'external';
}

/** Stop applies to anything holding the port. */
export function canStop(state: DevServerState): boolean {
  return isLive(state);
}

/** Start applies to a configured server that is not holding the port. */
export function canStart(state: DevServerState): boolean {
  return state === 'stopped' || state === 'failed';
}

/**
 * Port of the dev server serving this very window, or null in a packaged build.
 * Stopping it would take the app's own UI down, so its Stop and Restart are disabled.
 */
export function readHostPort(): number | null {
  if (typeof window === 'undefined') return null;
  const { hostname, port } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
  const n = Number(port);
  return port && Number.isInteger(n) ? n : null;
}
