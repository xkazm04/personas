// @ts-nocheck — visual-review prototype; wires to mocked vault credentials
// + sample messages. Not imported by the production adoption flow yet.
//
// Shared types + mock data for the three UC-picker-with-messaging variants.
// When one variant wins:
//   1. Drop @ts-nocheck
//   2. Replace MOCK_MESSAGING_CREDENTIALS with useVaultStore() filter on
//      connectorCategoryTags() returning "messaging"
//   3. Replace SAMPLE_MESSAGE_BY_UC with the template's use_cases[].sample_output
//   4. Replace TITLEBAR_SUBSCRIPTION_STATE with a field on TriggerSelection
//   5. Wire the "Test" button to the new test_channel_delivery IPC
//   6. Delete this file's prototype-only code paths
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Hash,
  Inbox,
  MessageCircle,
  MessageSquare,
  Send,
} from 'lucide-react';

// Lucide removed the `Slack` brand glyph in newer versions; `Hash`
// (channel-hash icon) reads as Slack in context and avoids the missing
// export. Keep a local alias so the rest of the prototype code reads
// naturally.
const Slack = Hash;

// ────────────────────────────────────────────────────────────────────────
// Mock vault credentials for the messaging category
// ────────────────────────────────────────────────────────────────────────

export interface MessagingChannel {
  id: string;            // stable identifier for the channel
  kind: 'built-in' | 'slack' | 'discord' | 'telegram' | 'teams';
  label: string;         // credential name (e.g. "Acme Slack") or "In-app"
  target?: string;       // e.g. "#signals" or "@trader_bot"
  icon: LucideIcon;
  color: string;         // tailwind token
  alwaysOn?: boolean;    // built-in can't be disabled
}

export const MOCK_MESSAGING_CHANNELS: MessagingChannel[] = [
  { id: 'built-in',   kind: 'built-in', label: 'In-app Messages', icon: Inbox,         color: 'text-primary',     alwaysOn: true },
  { id: 'slack-acme', kind: 'slack',    label: 'Acme Slack',       target: '#signals',  icon: Slack,         color: 'text-brand-cyan'   },
  { id: 'tg-trader',  kind: 'telegram', label: 'Trader Bot',       target: '@me',       icon: Send,          color: 'text-brand-purple' },
  { id: 'discord-fx', kind: 'discord',  label: 'FX Discord',       target: '#alerts',   icon: MessageSquare, color: 'text-brand-cyan'   },
];

// Sample output per UC — would come from template.use_cases[].sample_output.
// The shape matches the v3.2 proposal in C3-messaging-design.md §3.1.
export interface SampleOutput {
  title: string;
  body: string;
  format: 'markdown' | 'plaintext';
}

export const SAMPLE_MESSAGE_BY_UC: Record<string, SampleOutput> = {
  uc_signals: {
    title: 'Weekly Signals — Mon Apr 28',
    body:
      '**AAPL** · BUY (0.82)\n' +
      '• RSI 32.4 oversold, MACD turning positive, Q3 earnings beat\n\n' +
      '**NVDA** · HOLD (0.61)\n' +
      '• Signals conflict: technicals bullish, sector rotation bearish',
    format: 'markdown',
  },
  uc_congressional_scan: {
    title: 'Congressional Disclosures — Week 17',
    body:
      '3 matched disclosures in your Technology sector:\n' +
      '• Rep. Pelosi · NVDA · Purchase · $1M-5M · 2026-04-24\n' +
      '• Sen. Toomey · MSFT · Sale · $100K-250K · 2026-04-23',
    format: 'markdown',
  },
  uc_gems: {
    title: 'Sector Gems — Week 17',
    body:
      '2 under-covered names passing thresholds:\n' +
      '• PLTR · coverage=4 · tech=0.78 · catalyst=GovCloud contract\n' +
      '• IONQ · coverage=2 · tech=0.71 · catalyst=Q2 quantum benchmarks',
    format: 'markdown',
  },
};

// When no UC-specific sample exists, show this fallback.
export const FALLBACK_SAMPLE: SampleOutput = {
  title: 'Sample — Your Persona',
  body:
    'This is what a message from this capability will look like in the\n' +
    'selected channels. Template authors can customize this preview by\n' +
    'setting `use_cases[].sample_output` on the JSON.',
  format: 'markdown',
};

// ────────────────────────────────────────────────────────────────────────
// Per-UC messaging state (prototype local state)
// ────────────────────────────────────────────────────────────────────────

export interface UCChannelState {
  /** Channel ids the user picked for this UC. Always includes 'built-in'. */
  channelIds: Set<string>;
  /** Event types from event_subscriptions[emit] the user opted into for
   *  the TitleBar bell. */
  titlebarEventIds: Set<string>;
}

export const EMPTY_CHANNEL_STATE = (): UCChannelState => ({
  channelIds: new Set(['built-in']),
  titlebarEventIds: new Set(),
});

// ────────────────────────────────────────────────────────────────────────
// Mock emit-events per UC (would come from template.use_cases[].event_subscriptions)
// ────────────────────────────────────────────────────────────────────────

export interface EmitEventMeta {
  event_type: string;
  description: string;
  /** Whether the template author pre-selected this for TitleBar bell. */
  default_titlebar: boolean;
}

export const MOCK_EMIT_EVENTS_BY_UC: Record<string, EmitEventMeta[]> = {
  uc_signals: [
    { event_type: 'stocks.signals.buy',  description: 'Strong bullish composite',               default_titlebar: true  },
    { event_type: 'stocks.signals.sell', description: 'Strong bearish composite',               default_titlebar: true  },
    { event_type: 'stocks.signals.hold', description: 'Ambiguous / RSI-MACD disagreement',      default_titlebar: false },
  ],
  uc_congressional_scan: [
    { event_type: 'stocks.congress.disclosure',   description: 'Matched disclosure in watched sector', default_titlebar: false },
    { event_type: 'stocks.congress.sector_shift', description: 'Unusual sector disclosure volume',     default_titlebar: true  },
  ],
  uc_gems: [
    { event_type: 'stocks.gems.discovered',   description: 'Under-covered name passing thresholds', default_titlebar: true  },
    { event_type: 'stocks.gems.filtered_out', description: 'Candidate rejected with reason',        default_titlebar: false },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// Test delivery — mock the new `test_channel_delivery` IPC
// ────────────────────────────────────────────────────────────────────────

export interface TestDeliveryResult {
  channelId: string;
  success: boolean;
  latencyMs: number;
  error?: string;
}

export async function mockTestDelivery(
  channelIds: string[],
  sample: SampleOutput,
): Promise<TestDeliveryResult[]> {
  // Simulate varying latencies and an occasional failure for visual richness.
  const results: TestDeliveryResult[] = [];
  for (const id of channelIds) {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
    const fail = id === 'discord-fx' && Math.random() < 0.3; // flaky discord
    results.push({
      channelId: id,
      success: !fail,
      latencyMs: Math.floor(120 + Math.random() * 300),
      error: fail ? 'webhook 404 (channel not found)' : undefined,
    });
  }
  return results;
}

// Mock ambient persona-fixture for the Demo wrapper so each variant has
// the same UC list and template identity to render.
export const DEV_CLONE_FIXTURE_USE_CASES = [
  { id: 'uc_signals',            name: 'Weekly Signal Fetcher' },
  { id: 'uc_congressional_scan', name: 'Congressional Disclosure Scan' },
  { id: 'uc_gems',               name: 'Sector Gem Discovery' },
];

export const MESSAGE_COMPOSITION: 'shared' | 'per_use_case' = 'shared';

// Human-friendly channel-kind → icon map used by all variants.
export const CHANNEL_KIND_ICON: Record<MessagingChannel['kind'], LucideIcon> = {
  'built-in': Inbox,
  slack:       Slack,
  discord:     MessageSquare,
  telegram:    Send,
  teams:       MessageCircle,
};

export const BELL_ICON = Bell;
