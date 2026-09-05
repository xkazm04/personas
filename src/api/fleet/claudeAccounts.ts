/**
 * Tauri IPC wrappers for the multi-plan Claude login switcher.
 *
 * Mirrors `src-tauri/src/commands/fleet/claude_accounts/mod.rs`. Every call
 * returns the whole snapshot so the strip re-renders from one truth after a
 * mutation. A switch may wait on the CLI's own credential lock (up to 10s)
 * and refresh a token first, so it gets a longer timeout than a read.
 */

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';

const SWITCH_TIMEOUT_MS = 45_000;

/** Every stored login with its live usage, the live login's identity, and the rotation policy. */
export const listClaudeAccounts = () =>
  invoke<ClaudeAccountsSnapshot>('fleet_claude_accounts_list');

/** Store the CLI's current login as an account (or refresh its stored copy). */
export const captureClaudeAccount = () =>
  invoke<ClaudeAccountsSnapshot>('fleet_claude_account_capture', undefined, { timeoutMs: SWITCH_TIMEOUT_MS });

/** Make a stored login the CLI's live one. */
export const switchClaudeAccount = (id: string) =>
  invoke<ClaudeAccountsSnapshot>('fleet_claude_account_switch', { id }, { timeoutMs: SWITCH_TIMEOUT_MS });

/** Forget a stored login; the live file is untouched. */
export const removeClaudeAccount = (id: string) =>
  invoke<ClaudeAccountsSnapshot>('fleet_claude_account_remove', { id });

/** Set the auto-rotate policy. */
export const setClaudeAutoRotate = (config: ClaudeAutoRotateConfig) =>
  invoke<ClaudeAutoRotateConfig>('fleet_claude_auto_rotate_set', { config });
