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
import type { LoginProfileView } from '@/lib/bindings/LoginProfileView';
import type { ReloginState } from '@/lib/bindings/ReloginState';

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

// ── Re-login a dead plan (spark claude-plan-switch) ──────────────────────────

/** The run opens a real Chrome profile and waits for a code: slow by design. */
const RELOGIN_TIMEOUT_MS = 120_000;

/** Run a re-login for one stored plan. Resolves with the run's final state. */
export const reloginClaudeAccount = (accountId: string) =>
  invoke<ReloginState>('fleet_claude_relogin', { accountId }, { timeoutMs: RELOGIN_TIMEOUT_MS });

export const listClaudeLoginProfiles = () =>
  invoke<LoginProfileView[]>('fleet_claude_profile_list');

/** Create or update a browser profile; `vaultCredentialId` binds the Proton mailbox login. */
export const saveClaudeLoginProfile = (key: string, label: string, vaultCredentialId: string | null) =>
  invoke<LoginProfileView[]>('fleet_claude_profile_save', { key, label, vaultCredentialId });

/** Open the profile in a visible window so the operator can sign in by hand. */
export const openClaudeProfileHeaded = (key: string) =>
  invoke<void>('fleet_claude_profile_open_headed', { key });

/** Point an account at its sign-in profile, code inbox profile and the unattended switch. */
export const setClaudeAccountProfile = (
  accountId: string, profileKey: string | null, codeInboxProfileKey: string | null, reloginUnattended: boolean,
) =>
  invoke<ClaudeAccountsSnapshot>('fleet_claude_account_profile_set', {
    accountId, profileKey, codeInboxProfileKey, reloginUnattended,
  });
