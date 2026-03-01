// ============================================================================
// Design Wizard — Step Definitions & Instruction Compiler
// ============================================================================

export interface WizardOption {
  label: string;
  description: string;
}

export interface WizardQuestion {
  id: string;
  question: string;
  header: string;
  options: WizardOption[];
  multiSelect: boolean;
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  questions: WizardQuestion[];
}

export type WizardAnswers = Record<string, string | string[]>;

// ── Step Definitions ────────────────────────────────────────────

export const WIZARD_STEPS: WizardStep[] = [
  // ── Step 1: Mission ──────────────────────────────────────────
  {
    id: 'mission',
    title: 'Mission',
    description: 'Define the core purpose of this agent',
    questions: [
      {
        id: 'mission_type',
        question: 'What is the primary mission of this agent?',
        header: 'Mission',
        multiSelect: false,
        options: [
          {
            label: 'Inbox / Feed Monitor',
            description: 'Watches incoming data streams (email, messages, feeds), triages, categorizes, and surfaces what matters.',
          },
          {
            label: 'Data Processor & Router',
            description: 'Receives data, extracts information, transforms it, and routes to downstream systems or people.',
          },
          {
            label: 'Full Lifecycle Manager',
            description: 'End-to-end management: monitor, process, act, follow up, and report. Does it all within its domain.',
          },
          {
            label: 'Notification & Alert Hub',
            description: 'Monitors conditions and thresholds, sends targeted alerts and notifications when action is needed.',
          },
        ],
      },
    ],
  },

  // ── Step 2: Scope & Data ─────────────────────────────────────
  {
    id: 'scope',
    title: 'Scope & Data',
    description: 'What data does this agent work with and what should it produce',
    questions: [
      {
        id: 'data_scope',
        question: 'What data scope should the agent work with?',
        header: 'Data scope',
        multiSelect: false,
        options: [
          {
            label: 'All incoming data',
            description: 'Processes everything that arrives — no filtering. Suitable for dedicated channels or inboxes.',
          },
          {
            label: 'Specific sources (allowlist)',
            description: 'Only processes data from explicitly configured sources, senders, or domains. Everything else is ignored.',
          },
          {
            label: 'Filter / label-based',
            description: 'Processes data that matches specific filters, labels, tags, or rules. Leverages existing categorization.',
          },
          {
            label: 'Custom rules',
            description: 'Uses custom logic to decide what to process — content analysis, keyword matching, or conditional rules.',
          },
        ],
      },
      {
        id: 'data_actions',
        question: 'What should the agent do with the data it processes?',
        header: 'Output',
        multiSelect: true,
        options: [
          {
            label: 'Create tasks in a project tool',
            description: 'Creates tasks in ClickUp, Jira, Notion, or similar — with title, description, priority, and due dates.',
          },
          {
            label: 'Send notifications',
            description: 'Sends alerts via Slack, Telegram, email, or Discord when conditions are met.',
          },
          {
            label: 'Update spreadsheets or databases',
            description: 'Writes extracted data to Google Sheets, Airtable, or database tables for tracking and analysis.',
          },
          {
            label: 'Draft responses for review',
            description: 'Prepares reply drafts or response templates for human review before sending.',
          },
        ],
      },
    ],
  },

  // ── Step 3: Autonomy & Safety ────────────────────────────────
  {
    id: 'autonomy',
    title: 'Autonomy & Safety',
    description: 'How independently should this agent operate',
    questions: [
      {
        id: 'autonomy_level',
        question: 'How autonomous should the agent be?',
        header: 'Autonomy',
        multiSelect: false,
        options: [
          {
            label: 'Read-only + report',
            description: 'Can only read and analyze data. Reports findings but never modifies anything.',
          },
          {
            label: 'Read + organize',
            description: 'Can read, label, categorize, and sort data. Cannot send messages or create external records.',
          },
          {
            label: 'Full access with approval gates',
            description: 'Can do everything but pauses for human approval before sending messages or taking destructive actions.',
          },
          {
            label: 'Full autonomous',
            description: 'Operates independently without approval gates. Suitable for well-tested, low-risk workflows.',
          },
        ],
      },
      {
        id: 'approval_actions',
        question: 'Which actions should require your approval?',
        header: 'Approval gates',
        multiSelect: true,
        options: [
          {
            label: 'Sending messages or emails',
            description: 'Agent drafts outbound communication but waits for your OK before sending.',
          },
          {
            label: 'Creating or modifying external records',
            description: 'Task creation, database writes, or updates to external systems require confirmation.',
          },
          {
            label: 'Deleting or archiving data',
            description: 'Any destructive operation — delete, archive, or bulk modification — needs approval.',
          },
          {
            label: 'Only destructive / irreversible actions',
            description: 'Agent runs freely for safe operations. Only pauses for actions that cannot be undone.',
          },
        ],
      },
    ],
  },

  // ── Step 4: Triggers & Reporting ─────────────────────────────
  {
    id: 'triggers',
    title: 'Triggers & Reporting',
    description: 'When should this agent run and how should it report',
    questions: [
      {
        id: 'trigger_type',
        question: 'How should the agent be triggered?',
        header: 'Trigger',
        multiSelect: false,
        options: [
          {
            label: 'Real-time (webhook / push)',
            description: 'Triggered instantly when new data arrives via webhook or push notification. Lowest latency.',
          },
          {
            label: 'Scheduled (cron)',
            description: 'Runs on a fixed schedule — hourly, daily, weekly. Predictable and battery-friendly.',
          },
          {
            label: 'Polling interval',
            description: 'Checks for new data at regular intervals (e.g., every 5 minutes). Slight delay but simple setup.',
          },
          {
            label: 'Manual only',
            description: 'Only runs when you explicitly trigger it. Full control, no background processing.',
          },
        ],
      },
      {
        id: 'reporting_style',
        question: 'How should the agent report its activity?',
        header: 'Reporting',
        multiSelect: false,
        options: [
          {
            label: 'Silent (log only)',
            description: 'Works quietly. Check execution logs when curious. No proactive notifications.',
          },
          {
            label: 'Daily digest',
            description: 'One summary per day: items processed, actions taken, items needing attention.',
          },
          {
            label: 'Per-run summary',
            description: 'Brief notification after each processing run with what was done and what needs review.',
          },
          {
            label: 'Real-time notifications',
            description: 'Immediate notification for every significant action. Best for critical workflows.',
          },
        ],
      },
    ],
  },

  // ── Step 5: Review & Launch ──────────────────────────────────
  {
    id: 'review',
    title: 'Review & Generate',
    description: 'Review your choices and add any additional context',
    questions: [],
  },
];

// ── Instruction Compiler ────────────────────────────────────────

type InstructionEntry =
  | { type: 'single'; map: Record<string, string>; fallback: string }
  | { type: 'multi'; map: Record<string, string>; prefix: string };

const ANSWER_TO_INSTRUCTION: Record<string, InstructionEntry> = {
  mission_type: {
    type: 'single',
    fallback: 'Create an agent with this mission:',
    map: {
      'Inbox / Feed Monitor': 'Create an agent that monitors incoming data streams, triages and categorizes items by importance, and surfaces what requires attention.',
      'Data Processor & Router': 'Create an agent that processes incoming data, extracts key information, transforms it as needed, and routes it to the appropriate downstream systems.',
      'Full Lifecycle Manager': 'Create a full lifecycle management agent that handles end-to-end processing: monitoring, extraction, action creation, follow-up tracking, and comprehensive reporting.',
      'Notification & Alert Hub': 'Create an agent that monitors conditions and thresholds, detects important events, and sends targeted alerts and notifications to the right people.',
    },
  },
  data_scope: {
    type: 'single',
    fallback: 'Data scope:',
    map: {
      'All incoming data': 'It should process all incoming data without filtering.',
      'Specific sources (allowlist)': 'It should only process data from an explicitly configured allowlist of sources, senders, or domains. Include a configurable sender allowlist section in the prompt.',
      'Filter / label-based': 'It should only process data that matches specific filters, labels, or tags. Include configuration for filter rules.',
      'Custom rules': 'It should use custom rules to decide what to process, based on content analysis, keyword matching, or conditional logic.',
    },
  },
  data_actions: {
    type: 'multi',
    prefix: 'When processing data, the agent should:',
    map: {
      'Create tasks in a project tool': 'create tasks in a project management tool with title, description, priority, and due date extracted from the source data',
      'Send notifications': 'send notifications and alerts via messaging channels when conditions are met',
      'Update spreadsheets or databases': 'update spreadsheets or databases with extracted data for tracking and analysis',
      'Draft responses for review': 'draft response templates for human review before sending',
    },
  },
  autonomy_level: {
    type: 'single',
    fallback: 'Autonomy level:',
    map: {
      'Read-only + report': 'The agent should be read-only — it can analyze and report findings but never modify or create anything externally.',
      'Read + organize': 'The agent can read, label, categorize, and organize data, but cannot send messages or create external records.',
      'Full access with approval gates': 'The agent should have full access to its connected services but must pause for human approval before sending outbound messages or taking any destructive actions.',
      'Full autonomous': 'The agent should operate fully autonomously without requiring approval for any actions.',
    },
  },
  approval_actions: {
    type: 'multi',
    prefix: 'Specifically, require human approval for:',
    map: {},
  },
  trigger_type: {
    type: 'single',
    fallback: 'Trigger:',
    map: {
      'Real-time (webhook / push)': 'Use a real-time webhook or push notification trigger for instant processing when new data arrives.',
      'Scheduled (cron)': 'Use a scheduled cron trigger to run at fixed intervals (suggest an appropriate schedule based on the use case).',
      'Polling interval': 'Use a polling trigger to check for new data at regular intervals.',
      'Manual only': 'Use a manual trigger — the agent only runs when explicitly invoked by the user.',
    },
  },
  reporting_style: {
    type: 'single',
    fallback: 'Reporting:',
    map: {
      'Silent (log only)': 'The agent should operate silently, logging activity for review but not sending proactive notifications.',
      'Daily digest': 'The agent should generate a daily digest summarizing all activity: items processed, actions taken, items needing attention, and any errors.',
      'Per-run summary': 'The agent should send a brief summary notification after each processing run.',
      'Real-time notifications': 'The agent should send real-time notifications for every significant action taken.',
    },
  },
};

export function compileWizardInstruction(answers: WizardAnswers): string {
  const parts: string[] = [];

  for (const [key, entry] of Object.entries(ANSWER_TO_INSTRUCTION)) {
    const value = answers[key];
    if (!value) continue;

    if (entry.type === 'single' && typeof value === 'string') {
      parts.push(entry.map[value] || `${entry.fallback} ${value}`);
    } else if (entry.type === 'multi' && Array.isArray(value) && value.length > 0) {
      const mapped = value.map((v) => entry.map[v] || v.toLowerCase());
      parts.push(`${entry.prefix} ${mapped.join('; ')}.`);
    }
  }

  const additional = answers['additional_context'];
  if (additional && typeof additional === 'string' && additional.trim()) {
    parts.push(`\nAdditional context and requirements:\n${additional.trim()}`);
  }

  return parts.join('\n\n');
}

// ── Summary Helper ──────────────────────────────────────────────

export function getAnswerSummary(answers: WizardAnswers): Array<{ label: string; value: string }> {
  const summary: Array<{ label: string; value: string }> = [];

  const mission = answers['mission_type'];
  if (mission) summary.push({ label: 'Mission', value: mission as string });

  const scope = answers['data_scope'];
  if (scope) summary.push({ label: 'Data Scope', value: scope as string });

  const actions = answers['data_actions'];
  if (Array.isArray(actions) && actions.length > 0) {
    summary.push({ label: 'Actions', value: actions.join(', ') });
  }

  const autonomy = answers['autonomy_level'];
  if (autonomy) summary.push({ label: 'Autonomy', value: autonomy as string });

  const approvals = answers['approval_actions'];
  if (Array.isArray(approvals) && approvals.length > 0) {
    summary.push({ label: 'Approval Gates', value: approvals.join(', ') });
  }

  const trigger = answers['trigger_type'];
  if (trigger) summary.push({ label: 'Trigger', value: trigger as string });

  const reporting = answers['reporting_style'];
  if (reporting) summary.push({ label: 'Reporting', value: reporting as string });

  return summary;
}
