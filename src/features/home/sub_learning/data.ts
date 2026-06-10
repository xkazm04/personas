import {
  Compass, Activity, Radio, Sparkles, FlaskConical, Link, Zap, Shield, Eye,
  Palette, Brain, RotateCcw, Wrench, BarChart3, Puzzle, CalendarClock,
} from 'lucide-react';

// -- Tour icons & colors -----------------------------------------------

export const TOUR_ICONS: Record<string, typeof Compass> = {
  Compass, Activity, Radio, Sparkles, Puzzle, CalendarClock, FlaskConical, Brain,
};

export interface TourColorSet {
  bg: string;
  border: string;
  text: string;
  btnBg: string;
  btnBorder: string;
  btnText: string;
}

const FALLBACK: TourColorSet = { bg: 'bg-violet-500/5', border: 'border-violet-500/15', text: 'text-violet-400', btnBg: 'bg-violet-500/10', btnBorder: 'border-violet-500/25', btnText: 'text-violet-300' };

const COLORS: Record<string, TourColorSet> = {
  violet: FALLBACK,
  blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/15', text: 'text-blue-400', btnBg: 'bg-blue-500/10', btnBorder: 'border-blue-500/25', btnText: 'text-blue-300' },
  teal: { bg: 'bg-teal-500/5', border: 'border-teal-500/15', text: 'text-teal-400', btnBg: 'bg-teal-500/10', btnBorder: 'border-teal-500/25', btnText: 'text-teal-300' },
  amber: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', text: 'text-amber-400', btnBg: 'bg-amber-500/10', btnBorder: 'border-amber-500/25', btnText: 'text-amber-300' },
  emerald: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/15', text: 'text-emerald-400', btnBg: 'bg-emerald-500/10', btnBorder: 'border-emerald-500/25', btnText: 'text-emerald-300' },
  indigo: { bg: 'bg-indigo-500/5', border: 'border-indigo-500/15', text: 'text-indigo-400', btnBg: 'bg-indigo-500/10', btnBorder: 'border-indigo-500/25', btnText: 'text-indigo-300' },
};

export function getColors(k: string): TourColorSet { return COLORS[k] ?? FALLBACK; }

// -- Tricks data --------------------------------------------------------

export interface TrickStep {
  text: string;
  bold?: string;
}

export interface Trick {
  id: string;
  title: string;
  tagline: string;
  icon: typeof Sparkles;
  color: string;
  category: 'agent-craft' | 'observability' | 'platform';
  screenshot: string;
  steps: TrickStep[];
  proTip?: string;
}

export const TRICKS: Trick[] = [
  {
    id: 'persona-matrix',
    title: 'How Agents Are Built: The 8-Dimension Blueprint',
    tagline: 'Understand the complete blueprint behind every AI agent',
    icon: Sparkles,
    color: 'text-violet-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-persona-matrix.png',
    steps: [
      { text: 'Go to', bold: 'Agents > Create New' },
      { text: 'Every agent is defined across 8 independent dimensions:' },
      { text: 'Use Cases — what workflows it handles', bold: 'Identity' },
      { text: 'Connections — external apps and services it integrates with', bold: 'Capability' },
      { text: 'Triggers, Approvals, Messages, Memory, Error Handling, Events', bold: 'Behavior' },
      { text: 'Each dimension is configured independently during the setup process' },
    ],
    proTip: 'After the build completes, you can click any cell to manually edit its configuration before promoting.',
  },
  {
    id: 'arena-model-compare',
    title: 'Arena: Head-to-Head Model Comparison',
    tagline: 'Compare Haiku, Sonnet, and Opus on your actual use cases',
    icon: FlaskConical,
    color: 'text-amber-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-arena-model-compare.png',
    steps: [
      { text: 'Select any agent and open the', bold: 'Lab tab' },
      { text: 'Switch to', bold: 'Arena mode' },
      { text: 'Toggle models to compare (Haiku vs Sonnet vs Opus)' },
      { text: 'Click Run — the arena tests each model on your agent\'s scenarios' },
      { text: 'Results show composite scores for Tool Accuracy, Output Quality, and Protocol Compliance' },
    ],
    proTip: 'Use Arena after prompt changes to verify you haven\'t regressed on cheaper models.',
  },
  {
    id: 'prompt-versioning',
    title: 'Prompt Version Rollback',
    tagline: 'Every edit versioned, diffable, and rollbackable',
    icon: RotateCcw,
    color: 'text-cyan-400',
    category: 'agent-craft',
    screenshot: '/guides/trick-prompt-versioning.png',
    steps: [
      { text: 'Select an agent → open', bold: 'Lab > Versions' },
      { text: 'Every prompt edit creates a numbered version automatically' },
      { text: 'Click any two versions to see a side-by-side diff' },
      { text: 'Tag versions as Production, Experimental, or Archived' },
      { text: 'Rollback instantly if a new version causes regressions' },
    ],
    proTip: 'Select two versions and click "Run A/B Test" to scientifically compare them before promoting.',
  },
  {
    id: 'health-heartbeats',
    title: 'Agent Health Heartbeats',
    tagline: 'Score 0-100 for every agent in your fleet',
    icon: Activity,
    color: 'text-rose-400',
    category: 'observability',
    screenshot: '/guides/trick-health-heartbeats.png',
    steps: [
      { text: 'Go to', bold: 'Overview > Health' },
      { text: 'Each agent card shows a heartbeat score with color-coded grades:' },
      { text: 'Green (80+) = Healthy, Amber (50-79) = Degraded, Red (<50) = Critical' },
      { text: 'Expand any card to see success rate, failure count, cost projection, and average latency' },
    ],
    proTip: 'Filter by grade (Degraded/Critical) to quickly find agents that need attention.',
  },
  {
    id: 'message-threads',
    title: 'Threaded Agent Messages',
    tagline: 'Follow multi-agent conversations in context',
    icon: Brain,
    color: 'text-blue-400',
    category: 'observability',
    screenshot: '/guides/trick-message-threads.png',
    steps: [
      { text: 'Go to', bold: 'Overview > Messages' },
      { text: 'Toggle between Flat (chronological) and Threaded view modes' },
      { text: 'In Threaded view, parent messages group their replies with indented nesting' },
      { text: 'Filter by priority (High/Normal/Low) or read status (Unread)' },
      { text: 'Click "Mark All Read" to clear the unread badge count' },
    ],
    proTip: 'High-priority messages appear with a red badge — useful for error notifications from agents.',
  },
  {
    id: 'live-event-stream',
    title: 'Real-Time Event Stream',
    tagline: 'Watch your agent ecosystem pulse live',
    icon: Zap,
    color: 'text-yellow-400',
    category: 'observability',
    screenshot: '/guides/trick-live-event-stream.png',
    steps: [
      { text: 'Go to', bold: 'Events > Live Stream' },
      { text: 'Events appear in real-time: execution_completed, webhook_received, schedule_fired' },
      { text: 'Each event shows its type, source, target agent, and processing status' },
      { text: 'Filter by event type or persona to focus on specific chains' },
    ],
    proTip: 'Use the Live Stream while testing chain triggers — you\'ll see the cascade in real-time.',
  },
  {
    id: 'event-chaining',
    title: 'Chain Agents with Event Listeners',
    tagline: 'Build multi-agent workflows with the event bus',
    icon: Link,
    color: 'text-purple-400',
    category: 'observability',
    screenshot: '/guides/trick-event-chaining.png',
    steps: [
      { text: 'Go to', bold: 'Events > Builder' },
      { text: 'The canvas shows event sources (left) connected to consuming agents (right)' },
      { text: 'Agent A completes → emits execution_completed → Agent B\'s event_listener trigger fires → Agent B auto-executes' },
      { text: 'Use source_filter to limit which agent\'s events trigger the chain (e.g., only "persona-a")' },
    ],
    proTip: 'Combine chain triggers with composite triggers for time-windowed, multi-condition orchestration.',
  },
  {
    id: 'credential-healthcheck',
    title: 'Bulk Credential Health Check',
    tagline: 'Automated daily monitoring for all your credentials',
    icon: Shield,
    color: 'text-emerald-400',
    category: 'platform',
    screenshot: '/guides/trick-credential-healthcheck.png',
    steps: [
      { text: 'Open', bold: 'Credentials' },
      { text: 'Look at the status dots next to each credential — green means healthy, amber needs attention, red is failing' },
      { text: 'Health checks run automatically once per day on first vault access' },
      { text: 'Click any failing credential to see the audit log and trigger AI remediation' },
    ],
    proTip: 'The remediation engine can auto-rotate expired API keys and refresh OAuth tokens without manual intervention.',
  },
  {
    id: 'auto-credential-discovery',
    title: 'AI Credential Auto-Discovery',
    tagline: 'Paste a URL, AI extracts credentials automatically',
    icon: Eye,
    color: 'text-teal-400',
    category: 'platform',
    screenshot: '/guides/trick-auto-credential-discovery.png',
    steps: [
      { text: 'Open', bold: 'Credentials > Add New' },
      { text: 'Choose', bold: 'API Autopilot' },
      { text: 'Paste any service URL or OpenAPI spec URL' },
      { text: 'The AI-powered browser automation navigates to the service, finds the auth page, and extracts credential fields' },
      { text: 'Review the extracted fields and confirm — no manual form filling needed' },
    ],
    proTip: 'Also try the AI Setup Wizard for guided setup, or Desktop Bridge for local apps like VS Code and Docker.',
  },
  {
    id: 'custom-theme',
    title: 'Build a Custom Theme',
    tagline: '8 color slots, gradients, and live preview',
    icon: Palette,
    color: 'text-pink-400',
    category: 'platform',
    screenshot: '/guides/trick-custom-theme.png',
    steps: [
      { text: 'Go to', bold: 'Settings > Appearance' },
      { text: 'Scroll to the Theming section and click the', bold: 'Custom tab' },
      { text: 'Pick a primary color — the entire app transforms instantly' },
      { text: 'Tweak Accent, Background, Foreground, Secondary, Border, Card, and Muted Text colors' },
      { text: 'Enable Background Gradient for a polished depth effect' },
    ],
    proTip: 'The mini preview panel updates in real-time, so you can see changes before applying.',
  },
];

// -- Category definitions -----------------------------------------------

export const CATEGORIES: { key: Trick['category']; labelKey: 'cat_agent_craft' | 'cat_observability' | 'cat_platform'; icon: typeof Sparkles; color: string }[] = [
  { key: 'agent-craft', labelKey: 'cat_agent_craft', icon: Sparkles, color: 'text-violet-400' },
  { key: 'observability', labelKey: 'cat_observability', icon: BarChart3, color: 'text-blue-400' },
  { key: 'platform', labelKey: 'cat_platform', icon: Wrench, color: 'text-emerald-400' },
];
