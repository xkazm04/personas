import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

/**
 * The monitor layer's per-terminal model.
 *
 * Every field maps to a REAL data source, so this doubles as the wiring plan
 * for graduating the monitor from simulated stats to live ones:
 * - `state`, `dozing`, `headless`, `ageMin` → `FleetSession` (wired today)
 * - `subagentsTotal`                → transcript rollup `tools[]` count of the
 *                                     `Task` tool (`fleet_session_metadata`)
 * - `subagentsActive`               → PreToolUse/PostToolUse pairing on `Task`
 *                                     (hooks already received; small Rust delta)
 * - `subprocs`                      → Bash `run_in_background: true` tool_use
 *                                     inputs in the transcript (RollupAcc delta)
 *                                     or a child-process scan of `childPid`
 *                                     (`fleet_detect_processes` precedent)
 * - `outputTokens`, `contextTokens` → `FleetTokenTotals` / `lastContextTokens`
 *                                     from the incremental rollup
 * - `memMb`                         → per-PID memory, same scan as the orphan
 *                                     panel (needs periodic sampling)
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
