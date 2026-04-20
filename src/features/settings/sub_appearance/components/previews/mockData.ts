// PROTOTYPE — Shared mock data for Simple-mode preview variants.
// All three variants (Mosaic, Console, Inbox) consume this so they are
// directly comparable (per ui-variant-prototype skill guidance).
import personaMorning from './assets/persona-morning.png';
import personaSlack from './assets/persona-slack.png';
import personaPR from './assets/persona-pr.png';
import personaWriter from './assets/persona-writer.png';
import personaInvoice from './assets/persona-invoice.png';

export type PersonaState = 'active' | 'needs-setup';

export interface PersonaMock {
  id: string;
  avatar: string;          // emoji fallback
  illustration: string;    // imported asset URL
  name: string;
  blurb: string;
  connectors: string[];
  state: PersonaState;
  lastRun: string;
  accentTone: 'amber' | 'violet' | 'rose' | 'emerald' | 'gold';
}

export interface InboxItemMock {
  id: string;
  kind: 'approval' | 'message' | 'output' | 'health';
  personaId: string;
  personaName: string;
  time: string;
  title: string;
  body: string;
  severity: 'critical' | 'warning' | 'info';
  preview?: string;
  // For approval items:
  context?: { label: string; value: string }[];
  suggestions?: string[];
}

export interface ConnectionMock {
  id: string;
  name: string;
  ok: boolean;
}

export const personas: PersonaMock[] = [
  {
    id: 'morning-briefer',
    avatar: '☀',
    illustration: personaMorning,
    name: 'Morning Briefer',
    blurb: 'Daily 7am summary of email, calendar, and news',
    connectors: ['Gmail', 'Calendar'],
    state: 'active',
    lastRun: '7:02am',
    accentTone: 'amber',
  },
  {
    id: 'slack-listener',
    avatar: '💬',
    illustration: personaSlack,
    name: 'Slack Listener',
    blurb: 'Flags messages that mention me in #product',
    connectors: ['Slack'],
    state: 'active',
    lastRun: '12m',
    accentTone: 'violet',
  },
  {
    id: 'pr-reviewer',
    avatar: '🔍',
    illustration: personaPR,
    name: 'PR Reviewer',
    blurb: 'First-pass review on pull requests',
    connectors: ['GitHub'],
    state: 'needs-setup',
    lastRun: '—',
    accentTone: 'rose',
  },
  {
    id: 'weekly-writer',
    avatar: '✍',
    illustration: personaWriter,
    name: 'Weekly Writer',
    blurb: 'Drafts the Friday team update from activity logs',
    connectors: ['GitHub', 'Notion'],
    state: 'active',
    lastRun: '5pm',
    accentTone: 'emerald',
  },
  {
    id: 'invoice-watcher',
    avatar: '🧾',
    illustration: personaInvoice,
    name: 'Invoice Watcher',
    blurb: 'Alerts on invoices over my threshold',
    connectors: ['Gmail'],
    state: 'active',
    lastRun: '5m',
    accentTone: 'gold',
  },
];

export const inbox: InboxItemMock[] = [
  {
    id: 'inv-1',
    kind: 'approval',
    personaId: 'invoice-watcher',
    personaName: 'Invoice Watcher',
    time: '5 min ago',
    title: 'Approve $2,340 — Figma annual renewal',
    body: 'Detected in your Gmail inbox from billing@figma.com. This matches your recurring subscription rule, so it will file itself once approved. Quick look before it goes through.',
    severity: 'warning',
    preview: 'Figma Inc. · Invoice #F-298412 · Due Apr 22',
    context: [
      { label: 'Amount',      value: '$2,340.00 USD' },
      { label: 'Vendor',      value: 'Figma Inc.' },
      { label: 'Matches rule',value: 'Recurring SaaS > $1k' },
      { label: 'Due',         value: 'Apr 22, 2026' },
    ],
    suggestions: ['Approve & file', 'Approve but flag', 'Defer 24h', 'Reject'],
  },
  {
    id: 'slk-1',
    kind: 'message',
    personaId: 'slack-listener',
    personaName: 'Slack Listener',
    time: '12 min ago',
    title: 'Alex mentioned you in #product-review',
    body: '@klara can you take a look at the onboarding spec? Tagging you because the flow you built for the briefing step is exactly the pattern I want to reuse — thoughts on whether this maps?',
    severity: 'info',
    preview: '#product-review · Alex Chen',
    suggestions: ['Open thread', 'Quick reply', 'Snooze until tomorrow'],
  },
  {
    id: 'ww-1',
    kind: 'output',
    personaId: 'weekly-writer',
    personaName: 'Weekly Writer',
    time: '2h ago',
    title: 'Draft ready — Friday team update',
    body: 'Three paragraphs covering 12 highlights pulled from GitHub activity and Notion docs. Tone leans upbeat per your preference. Send-ready after a quick read.',
    severity: 'info',
    preview: 'Team update · 312 words · upbeat',
    suggestions: ['Read draft', 'Send as-is', 'Request revision'],
  },
  {
    id: 'pr-1',
    kind: 'health',
    personaId: 'pr-reviewer',
    personaName: 'PR Reviewer',
    time: '4h ago',
    title: 'Paused — GitHub token expired',
    body: 'Your GitHub connection needs re-authentication. No reviews have been missed yet. Takes about 20 seconds to reconnect.',
    severity: 'critical',
    preview: 'Connection · auth expired',
    suggestions: ['Reconnect GitHub', 'Dismiss for now'],
  },
  {
    id: 'mb-1',
    kind: 'output',
    personaId: 'morning-briefer',
    personaName: 'Morning Briefer',
    time: '7h ago',
    title: 'Your morning digest · 3 meetings, 2 urgent',
    body: 'Urgent: Alex needs Q2 numbers before 11. Onboarding sync moved to 2pm. Two recruiting calls are stacked after lunch — consider blocking prep time.',
    severity: 'info',
    preview: 'Digest · 14 items triaged',
    suggestions: ['Read digest', 'Archive'],
  },
];

export const connections: ConnectionMock[] = [
  { id: 'gmail',    name: 'Gmail',    ok: true },
  { id: 'calendar', name: 'Calendar', ok: true },
  { id: 'slack',    name: 'Slack',    ok: true },
  { id: 'github',   name: 'GitHub',   ok: false },
];

// Derived summary
export const summary = {
  activeCount: personas.filter((p) => p.state === 'active').length,
  needsSetupCount: personas.filter((p) => p.state === 'needs-setup').length,
  inboxNewCount: 3,
  inboxNeedsMeCount: inbox.filter((i) => i.kind === 'approval' || i.severity === 'critical').length,
  connectionsOkCount: connections.filter((c) => c.ok).length,
  connectionsTotal: connections.length,
  runsToday: 14,
  savedToday: '~2h',
};
