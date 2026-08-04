import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { ProtoTerminal } from './mockFleet';

/**
 * Adapter: REAL fleet sessions → the monitor model the three variants render.
 *
 * Real fields: id, project, label, state, dozing, headless, ageMin.
 * SIMULATED (deterministic per session id, until the backend lanes land —
 * see mockFleet.ts for the wiring plan): subprocs, subagents, tokens, memMb.
 * Simulation is seeded by the session id so values are stable across renders
 * and reloads — the UX reads real, only the numbers are placeholders.
 */

/** FNV-1a — tiny stable hash for per-session simulated stats. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function sessionToMonitorTerminal(s: FleetSession, nowMs: number): ProtoTerminal {
  const h = fnv(s.id);
  const working = s.state === 'running' || s.state === 'spawning';
  const dead = s.state === 'exited' || s.state === 'hibernated';
  const hasProcess = !dead && !s.dozing && s.childPid != null;
  const headless = s.mode === 'headless';
  const last = Number(s.lastActivityMs);
  const subagentsActive = working ? h % 3 : 0;
  return {
    id: s.id,
    project: s.projectLabel,
    label: s.name ?? s.title ?? s.projectLabel,
    state: s.state,
    dozing: s.dozing,
    headless,
    subprocs: hasProcess && h % 5 < 2 ? 1 + (h % 3) : 0,
    subagentsActive,
    subagentsTotal: subagentsActive + ((h >> 3) % 8),
    outputTokens: (2 + ((h >> 5) % 220)) * 1000,
    contextTokens: (4 + ((h >> 8) % 150)) * 1000,
    memMb: hasProcess ? (headless ? 40 + (h % 50) : 180 + (h % 320)) : 0,
    ageMin: last > 0 ? Math.max(0, Math.round((nowMs - last) / 60_000)) : 0,
  };
}

export function sessionsToMonitorModel(sessions: FleetSession[]): ProtoTerminal[] {
  const now = Date.now();
  return sessions.map((s) => sessionToMonitorTerminal(s, now));
}
