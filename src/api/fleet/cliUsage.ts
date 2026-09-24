// Passive usage of the OTHER coding CLIs on this machine (Codex, Grok), for the
// Monitor's usage strip (`src-tauri/src/commands/fleet/cli_usage/`).
//
// Read-only and informational: these numbers never feed auto-rotate, the usage
// governor or pacing. A provider that cannot be read is a card state
// (`CliProviderUsage.reason`), not a rejection — the call always resolves with
// one entry per provider.

import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';

/** Every provider's usage card, in display order. */
export const getCliUsage = () => invoke<CliUsageSnapshot>('fleet_cli_usage');
