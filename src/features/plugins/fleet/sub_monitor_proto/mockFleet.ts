import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

/**
 * Mocked data model for the minimized-monitor prototype.
 *
 * Every field maps to a REAL data source so the prototype doubles as a
 * feasibility statement (see docs in the PR / session summary):
 * - `state`, `dozing`, `headless`  → `FleetSession` (available today)
 * - `subagentsTotal`               → transcript rollup `tools[]` count of the
 *                                    `Task` tool (`fleet_session_metadata`, today)
 * - `subagentsActive`              → PreToolUse/PostToolUse pairing on `Task`
 *                                    (hooks already received; small Rust delta)
 * - `subprocs`                     → Bash `run_in_background: true` tool_use
 *                                    inputs in the transcript (RollupAcc delta)
 *                                    or a child-process scan of `childPid`
 *                                    (`fleet_detect_processes` precedent)
 * - `outputTokens`, `contextTokens`→ `FleetTokenTotals` / `lastContextTokens`
 *                                    from the incremental rollup (today)
 * - `memMb`                        → per-PID memory, same scan as the orphan
 *                                    panel (today, needs periodic sampling)
 */
export interface ProtoTerminal {
  id: string;
  project: string;
  label: string;
  state: FleetSessionState;
  dozing: boolean;
  headless: boolean;
  /** Live background subprocesses (Bash run_in_background). */
  subprocs: number;
  /** Subagents (Task tool) currently open. */
  subagentsActive: number;
  /** Subagents triggered over the session's lifetime. */
  subagentsTotal: number;
  /** Total output tokens — the "effort spent" proxy. */
  outputTokens: number;
  /** Context re-sent each turn (the ctx pill signal). */
  contextTokens: number;
  /** Process RSS in MB (0 when dozing/hibernated/exited — no process). */
  memMb: number;
  /** Minutes since last activity signal. */
  ageMin: number;
}

const PROJECTS = ['personas', 'personas-web', 'candi-date', 'adamant', 'ascent', 'pof'] as const;

const TASKS = [
  'Refactor vault catalog', 'i18n gap sweep', 'Fix flaky tour test', 'Ship tab polish',
  'Trigger schema audit', 'Healing engine probe', 'Sidebar cold-load', 'Recipe param wiring',
  'KPI simulation run', 'Connector drift scan', 'Overlay z-index fix', 'Doc sync pass',
  'Backlog triage', 'Design token migrate', 'Sentry issue burn', 'Context map refresh',
  'Skill registry sync', 'Onboarding step copy', 'Perf memo pass', 'Clippy warning zero',
];

// Weighted toward the states a 50-fleet actually sits in mid-run.
const STATE_POOL: FleetSessionState[] = [
  'running', 'running', 'running', 'running', 'running',
  'idle', 'idle', 'idle',
  'awaiting_input', 'awaiting_input',
  'stale', 'finished', 'finished', 'hibernated', 'spawning', 'exited',
];

/** Deterministic LCG so every reload shows the identical fleet (stable A/B). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function makeMockFleet(count = 50, seed = 42): ProtoTerminal[] {
  const rnd = lcg(seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

  return Array.from({ length: count }, (_, i) => {
    const state = pick(STATE_POOL);
    const parked = state === 'awaiting_input' || state === 'stale';
    const dead = state === 'exited' || state === 'hibernated';
    const working = state === 'running' || state === 'spawning';
    const dozing = parked && rnd() < 0.4;
    const headless = rnd() < 0.2;
    const hasProcess = !dead && !dozing;
    const subagentsActive = working ? int(0, 3) : 0;
    return {
      id: `proto-${i}`,
      project: pick(PROJECTS),
      label: `${pick(TASKS)} ${i % 7 === 0 ? '(retry)' : ''}`.trim(),
      state,
      dozing,
      headless,
      subprocs: hasProcess && rnd() < 0.45 ? int(1, 4) : 0,
      subagentsActive,
      subagentsTotal: subagentsActive + int(0, 9),
      outputTokens: int(2, 240) * 1000,
      contextTokens: int(4, 165) * 1000,
      memMb: hasProcess ? (headless ? int(40, 90) : int(180, 520)) : 0,
      ageMin: working ? int(0, 3) : int(1, 45),
    };
  });
}

/** Fleet-wide aggregates for the monitor header strip. */
export function fleetTotals(fleet: ProtoTerminal[]) {
  return fleet.reduce(
    (acc, t) => {
      acc.subprocs += t.subprocs;
      acc.subagentsActive += t.subagentsActive;
      acc.outputTokens += t.outputTokens;
      acc.memMb += t.memMb;
      if (t.state === 'running' || t.state === 'spawning') acc.working += 1;
      if (t.state === 'awaiting_input') acc.awaiting += 1;
      return acc;
    },
    { subprocs: 0, subagentsActive: 0, outputTokens: 0, memMb: 0, working: 0, awaiting: 0 },
  );
}
