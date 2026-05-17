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
