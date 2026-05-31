/**
 * Tauri IPC wrappers for the Fleet plugin.
 *
 * Mirrors `src-tauri/src/commands/fleet/commands.rs`. Every call uses
 * `invokeWithTimeout` per the ESLint rule (`no-restricted-imports`
 * forbids raw `@tauri-apps/api/core` invokes).
 */

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { FleetRegistrySnapshot } from '@/lib/bindings/FleetRegistrySnapshot';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

/**
 * Spawn a new Claude Code session in a PTY rooted at `cwd`.
 * Returns the freshly-minted internal session id (UUID v4).
 *
 * The Rust side enforces one session per cwd; calling twice with the
 * same cwd before the first session exits throws.
 */
export const spawnSession = (
  cwd: string,
  args?: string[],
  cols?: number,
  rows?: number,
) => invoke<string>('fleet_spawn_session', { cwd, args, cols, rows });

/**
 * Write UTF-8 text to a session's PTY stdin. Does NOT append a newline —
 * the caller is responsible for `\r` / `\n` (xterm.js `onData` already
 * ships raw key bytes including those).
 */
export const writeInput = (sessionId: string, text: string) =>
  invoke<null>('fleet_write_input', { sessionId, text });

/**
 * Resize a session's PTY. Call after xterm.js's fit-addon recomputes.
 */
export const resizeSession = (sessionId: string, cols: number, rows: number) =>
  invoke<null>('fleet_resize_session', { sessionId, cols, rows });

/**
 * Kill a session's child process. Idempotent (already-exited sessions
 * silently succeed).
 */
export const killSession = (sessionId: string) =>
  invoke<null>('fleet_kill_session', { sessionId });

/**
 * Snapshot the registry — every tracked session plus install state of
 * the Claude Code hook receivers.
 */
export const listSessions = () =>
  invoke<FleetRegistrySnapshot>('fleet_list_sessions', {});

/**
 * Drop an exited session from the registry. Resolves to `true` if a row
 * was removed.
 */
export const removeSession = (sessionId: string) =>
  invoke<boolean>('fleet_remove_session', { sessionId });

/**
 * Install (or re-install) Fleet's Claude Code hook entries into
 * `~/.claude/settings.json`. Idempotent.
 */
export const installHooks = () =>
  invoke<FleetHookStatus>('fleet_install_hooks', {});

/**
 * Remove every Fleet-tagged hook entry. User-authored hooks are
 * preserved.
 */
export const uninstallHooks = () =>
  invoke<FleetHookStatus>('fleet_uninstall_hooks', {});

/**
 * Report the current state of Fleet's hook entries in
 * `~/.claude/settings.json`. Drives the settings-page install banner.
 */
export const checkHooks = () =>
  invoke<FleetHookStatus>('fleet_check_hooks', {});

/**
 * Set (or clear with `null` / empty string) the user-supplied display
 * name for a session. The Rust side trims whitespace and treats empty
 * as null. Resolves to `true` if the session existed and was updated.
 */
export const renameSession = (sessionId: string, name: string | null) =>
  invoke<boolean>('fleet_rename_session', { sessionId, name });

/**
 * Hibernate a session: kill the `claude` process to free it, keeping the row
 * (state → `hibernated`) so it can be resumed. Resolves to `false` if the
 * session can't be hibernated (already exited/hibernated, or never bound a
 * claude_session_id).
 */
export const hibernateSession = (sessionId: string) =>
  invoke<boolean>('fleet_hibernate_session', { sessionId });

/**
 * Wake a hibernated session: spawn a fresh PTY running
 * `claude --resume <claudeSessionId>` in the original cwd and drop the
 * hibernated placeholder. Resolves to the new session id.
 */
export const wakeSession = (sessionId: string, cols?: number, rows?: number) =>
  invoke<string>('fleet_wake_session', { sessionId, cols, rows });

/**
 * Configure the always-on auto-hibernate policy (P3.2): the staleness ticker
 * hibernates Idle/Stale sessions inactive longer than `afterMinutes` when
 * `enabled`. The frontend owns the persisted setting and pushes it here on
 * change + on startup.
 */
export const setAutoHibernate = (enabled: boolean, afterMinutes: number) =>
  invoke<null>('fleet_set_auto_hibernate', { enabled, afterMinutes });

/**
 * Read + summarize a session's Claude Code transcript
 * (`~/.claude/projects/**\/<claudeSessionId>.jsonl`) into a structured
 * rollup: token totals, per-tool counts, files touched, message counts,
 * timestamps. The P0 ingestion core consumed by the transcript-intelligence
 * UI (F2). Requires a bound `claudeSessionId` (null while Spawning).
 */
export const readTranscript = (claudeSessionId: string) =>
  invoke<FleetTranscriptSummary>('fleet_read_transcript', { claudeSessionId });

/**
 * Summarize the most recently-active transcripts across all projects — the
 * data source for the cross-session activity feed (F2 / P2.2). Scans
 * `~/.claude/projects` for `*.jsonl` modified within `withinDays` (default 7)
 * and returns the `limit` (default 50) most-recent rollups, newest first.
 */
export const recentTranscripts = (withinDays?: number, limit?: number) =>
  invoke<FleetTranscriptSummary[]>('fleet_recent_transcripts', {
    withinDays: withinDays ?? null,
    limit: limit ?? null,
  });

/**
 * Scan the OS process table for running Claude Code CLI processes — including
 * orphans the in-memory registry lost across an app restart (otherwise
 * reachable only via Task Manager). `tracked` flags PIDs that still match a
 * live Fleet session; untracked ones are orphans/external and sort first.
 */
export const detectProcesses = () =>
  invoke<FleetDetectedProcess[]>('fleet_detect_processes');

/**
 * Kill a single detected process by PID (targeted — never a blanket kill).
 * Resolves `true` if the process existed and the signal was sent.
 */
export const killPid = (pid: number) =>
  invoke<boolean>('fleet_kill_pid', { pid });
