/**
 * Tauri IPC wrapper for the Activity board's Claude usage strip.
 *
 * Mirrors `src-tauri/src/commands/fleet/claude_usage.rs`. One call returns the
 * subscription's rolling rate-limit windows (5-hour, 7-day, per-family 7-day
 * where the account reports them); the backend caches for ~45s, so a poll
 * from two open surfaces costs one upstream request.
 */

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { ClaudeUsageSnapshot } from '@/lib/bindings/ClaudeUsageSnapshot';

/** The signed-in Claude subscription's live usage, or an `available: false`
 *  snapshot carrying a machine `reason` when there is no OAuth login. */
export const claudeUsage = () => invoke<ClaudeUsageSnapshot>('fleet_claude_usage');
