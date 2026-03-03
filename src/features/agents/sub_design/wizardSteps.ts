// Design Wizard — Step Definitions & Types

export interface WizardOption { label: string; description: string; }

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

// Re-export compiler functions so existing imports stay valid
export { compileWizardInstruction, getAnswerSummary } from './wizardCompiler';

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'mission',
    title: 'Mission',
    description: 'Define the core purpose of this agent',
    questions: [{
      id: 'mission_type',
      question: 'What is the primary mission of this agent?',
      header: 'Mission',
      multiSelect: false,
      options: [
        { label: 'Inbox / Feed Monitor', description: 'Watches incoming data streams (email, messages, feeds), triages, categorizes, and surfaces what matters.' },
        { label: 'Data Processor & Router', description: 'Receives data, extracts information, transforms it, and routes to downstream systems or people.' },
        { label: 'Full Lifecycle Manager', description: 'End-to-end management: monitor, process, act, follow up, and report. Does it all within its domain.' },
        { label: 'Notification & Alert Hub', description: 'Monitors conditions and thresholds, sends targeted alerts and notifications when action is needed.' },
      ],
    }],
  },
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
          { label: 'All incoming data', description: 'Processes everything that arrives — no filtering. Suitable for dedicated channels or inboxes.' },
          { label: 'Specific sources (allowlist)', description: 'Only processes data from explicitly configured sources, senders, or domains. Everything else is ignored.' },
          { label: 'Filter / label-based', description: 'Processes data that matches specific filters, labels, tags, or rules. Leverages existing categorization.' },
          { label: 'Custom rules', description: 'Uses custom logic to decide what to process — content analysis, keyword matching, or conditional rules.' },
        ],
      },
      {
        id: 'data_actions',
        question: 'What should the agent do with the data it processes?',
        header: 'Output',
        multiSelect: true,
        options: [
          { label: 'Create tasks in a project tool', description: 'Creates tasks in ClickUp, Jira, Notion, or similar — with title, description, priority, and due dates.' },
          { label: 'Send notifications', description: 'Sends alerts via Slack, Telegram, email, or Discord when conditions are met.' },
          { label: 'Update spreadsheets or databases', description: 'Writes extracted data to Google Sheets, Airtable, or database tables for tracking and analysis.' },
          { label: 'Draft responses for review', description: 'Prepares reply drafts or response templates for human review before sending.' },
        ],
      },
    ],
  },
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
          { label: 'Read-only + report', description: 'Can only read and analyze data. Reports findings but never modifies anything.' },
          { label: 'Read + organize', description: 'Can read, label, categorize, and sort data. Cannot send messages or create external records.' },
          { label: 'Full access with approval gates', description: 'Can do everything but pauses for human approval before sending messages or taking destructive actions.' },
          { label: 'Full autonomous', description: 'Operates independently without approval gates. Suitable for well-tested, low-risk workflows.' },
        ],
      },
      {
        id: 'approval_actions',
        question: 'Which actions should require your approval?',
        header: 'Approval gates',
        multiSelect: true,
        options: [
          { label: 'Sending messages or emails', description: 'Agent drafts outbound communication but waits for your OK before sending.' },
          { label: 'Creating or modifying external records', description: 'Task creation, database writes, or updates to external systems require confirmation.' },
          { label: 'Deleting or archiving data', description: 'Any destructive operation — delete, archive, or bulk modification — needs approval.' },
          { label: 'Only destructive / irreversible actions', description: 'Agent runs freely for safe operations. Only pauses for actions that cannot be undone.' },
        ],
      },
    ],
  },
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
          { label: 'Real-time (webhook / push)', description: 'Triggered instantly when new data arrives via webhook or push notification. Lowest latency.' },
          { label: 'Scheduled (cron)', description: 'Runs on a fixed schedule — hourly, daily, weekly. Predictable and battery-friendly.' },
          { label: 'Polling interval', description: 'Checks for new data at regular intervals (e.g., every 5 minutes). Slight delay but simple setup.' },
          { label: 'Manual only', description: 'Only runs when you explicitly trigger it. Full control, no background processing.' },
        ],
      },
      {
        id: 'reporting_style',
        question: 'How should the agent report its activity?',
        header: 'Reporting',
        multiSelect: false,
        options: [
          { label: 'Silent (log only)', description: 'Works quietly. Check execution logs when curious. No proactive notifications.' },
          { label: 'Daily digest', description: 'One summary per day: items processed, actions taken, items needing attention.' },
          { label: 'Per-run summary', description: 'Brief notification after each processing run with what was done and what needs review.' },
          { label: 'Real-time notifications', description: 'Immediate notification for every significant action. Best for critical workflows.' },
        ],
      },
    ],
  },
  {
    id: 'review',
    title: 'Review & Generate',
    description: 'Review your choices and add any additional context',
    questions: [],
  },
];
