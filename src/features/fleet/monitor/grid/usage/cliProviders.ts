// cliProviders — the read-only CLIs the resource strip observes, in display
// order, and the snapshot a rejected IPC becomes. Kept apart from the hook so the
// pure model can name the providers without importing a poll.

import type { CliProvider } from '@/lib/bindings/CliProvider';
import type { CliUsageSnapshot } from '@/lib/bindings/CliUsageSnapshot';

/** The providers this strip knows, in display order. */
export const CLI_PROVIDERS: readonly CliProvider[] = ['codex', 'grok'];

/** What a rejected IPC becomes: every provider present, none readable. */
export function unreadableCliUsage(): CliUsageSnapshot {
  return {
    providers: CLI_PROVIDERS.map((provider) => ({
      provider,
      installed: false,
      version: null,
      planType: null,
      windows: [],
      asOfMs: null,
      projected: false,
      reason: 'unreadable' as const,
    })),
  };
}
