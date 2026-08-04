import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { ScreenHealth } from '@/lib/bindings/ScreenHealth';

/**
 * The monitor layer's per-terminal model.
 *
 * Where each field comes from for a session with a bound transcript:
 * - `state`, `dozing`, `headless`, `ageMin` → `FleetSession`
 * - `subagentsTotal`                → `fleet_monitor_stats`, from the rollup's
 *                                     `Task` tool count
 * - `outputTokens`, `contextTokens` → `fleet_monitor_stats`, from the
 *                                     incremental transcript rollup
 * - `memMb`                         → `fleet_monitor_stats`, per-PID RSS
 * - `subagentsActive`               → `fleet_monitor_stats`, from the
 *                                     PreToolUse/PostToolUse pairing on `Task`
 * - `subprocs`                      → `fleet_monitor_stats`, from the rollup's
 *                                     count of backgrounded `Bash` runs
 * - `screenHealth`                  → `fleet_monitor_stats`, the last screen
 *                                     delta a render already measured
 *
 * Sessions with NO bound transcript keep the fnv placeholder for every stat
 * and set `simulated`.
 */
export interface MonitorTerminal {
  id: string;
  /** True when the stats below are the fnv placeholder, not measured values —
   *  a session with no bound `claudeSessionId` has no transcript to read. */
  simulated: boolean;
  project: string;
  label: string;
  state: FleetSessionState;
  dozing: boolean;
  headless: boolean;
  /** Background shells launched over the session's lifetime (Bash
   *  `run_in_background: true`). */
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
  /** Verdict on the session's last screen delta, or `null` when no render has
   *  ever been taken for it. Real even on an otherwise `simulated` row. */
  screenHealth: ScreenHealth | null;
}
