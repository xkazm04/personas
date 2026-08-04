import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetMonitorStats } from '@/lib/bindings/FleetMonitorStats';
import type { MonitorTerminal } from './monitorTypes';

/**
 * Adapter: REAL fleet sessions → the monitor model the ledger renders.
 *
 * Session shape (id, project, label, state, dozing, headless, ageMin) comes
 * from `FleetSession`; the stats come from `fleet_monitor_stats` (transcript
 * rollup + per-PID memory), joined here by session id.
 *
 * A session that never bound a `claudeSessionId` has no transcript to read and
 * therefore no stats at all — those rows keep the deterministic fnv SIMULATION
 * (seeded by the session id so the numbers are stable across renders) and are
 * flagged `simulated` so the ledger can mark them as placeholders.
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

/** The fields that come straight off the session row — never simulated. */
function baseTerminal(s: FleetSession, nowMs: number) {
  const last = Number(s.lastActivityMs);
  return {
    id: s.id,
    project: s.projectLabel,
    label: s.name ?? s.title ?? s.projectLabel,
    state: s.state,
    dozing: s.dozing,
    headless: s.mode === 'headless',
    ageMin: last > 0 ? Math.max(0, Math.round((nowMs - last) / 60_000)) : 0,
  };
}

/** Placeholder stats for a session with no bound transcript. */
function simulatedTerminal(s: FleetSession, nowMs: number): Omit<MonitorTerminal, 'screenHealth'> {
  const h = fnv(s.id);
  const base = baseTerminal(s, nowMs);
  const working = s.state === 'running' || s.state === 'spawning';
  const dead = s.state === 'exited' || s.state === 'hibernated';
  const hasProcess = !dead && !s.dozing && s.childPid != null;
  const subagentsActive = working ? h % 3 : 0;
  return {
    ...base,
    simulated: true,
    subprocs: hasProcess && h % 5 < 2 ? 1 + (h % 3) : 0,
    subagentsActive,
    subagentsTotal: subagentsActive + ((h >> 3) % 8),
    outputTokens: (2 + ((h >> 5) % 220)) * 1000,
    contextTokens: (4 + ((h >> 8) % 150)) * 1000,
    memMb: hasProcess ? (base.headless ? 40 + (h % 50) : 180 + (h % 320)) : 0,
  };
}

export function sessionToMonitorTerminal(
  s: FleetSession,
  nowMs: number,
  stats?: FleetMonitorStats,
): MonitorTerminal {
  // Screen movement is measured off the PTY, not the transcript, so it is
  // real even on a row whose numbers are placeholders.
  const screenHealth = stats?.screenHealth ?? null;
  if (!stats || !stats.claudeSessionId) {
    return { ...simulatedTerminal(s, nowMs), screenHealth };
  }
  return {
    ...baseTerminal(s, nowMs),
    simulated: false,
    screenHealth,
    subprocs: stats.bgProcsLaunched,
    subagentsActive: stats.subagentsActive,
    subagentsTotal: stats.subagentsTotal,
    outputTokens: Number(stats.outputTokens),
    contextTokens: Number(stats.contextTokens),
    memMb: stats.memMb == null ? 0 : Number(stats.memMb),
  };
}

/** Field-by-field equality — every `MonitorTerminal` field is a primitive. */
function sameTerminal(a: MonitorTerminal, b: MonitorTerminal): boolean {
  return (
    a.id === b.id
    && a.simulated === b.simulated
    && a.project === b.project
    && a.label === b.label
    && a.state === b.state
    && a.dozing === b.dozing
    && a.headless === b.headless
    && a.subprocs === b.subprocs
    && a.subagentsActive === b.subagentsActive
    && a.subagentsTotal === b.subagentsTotal
    && a.outputTokens === b.outputTokens
    && a.contextTokens === b.contextTokens
    && a.memMb === b.memMb
    && a.ageMin === b.ageMin
    && a.screenHealth === b.screenHealth
  );
}

/**
 * Build the ledger model, REUSING the previous terminal object for any session
 * whose fields did not move.
 *
 * Identity is the whole point: the ledger's rows are memoized on their own
 * terminal, and this adapter runs on every stats poll and every session-state
 * event. Rebuilding fresh objects each call would make all ~50 rows look
 * changed and defeat the memo — the caller passes the last result back in and
 * only genuinely-moved rows get a new reference.
 */
export function sessionsToMonitorModel(
  sessions: FleetSession[],
  stats?: Map<string, FleetMonitorStats>,
  prev?: MonitorTerminal[],
): MonitorTerminal[] {
  const now = Date.now();
  const prevById = prev && prev.length > 0 ? new Map(prev.map((t) => [t.id, t])) : null;
  return sessions.map((s) => {
    const next = sessionToMonitorTerminal(s, now, stats?.get(s.id));
    const before = prevById?.get(s.id);
    return before && sameTerminal(before, next) ? before : next;
  });
}
