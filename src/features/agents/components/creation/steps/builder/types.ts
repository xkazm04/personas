import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';

// -- Builder Use Case ------------------------------------------------

export interface BuilderUseCase {
  id: string;
  title: string;
  description: string;
  category: string;
  executionMode: 'e2e' | 'mock' | 'non_executable';
  trigger: TriggerPreset | null;
}

// -- Trigger Presets -------------------------------------------------

export interface TriggerPreset {
  label: string;
  type: 'manual' | 'schedule' | 'webhook';
  cron?: string;
}

export const TRIGGER_PRESETS: TriggerPreset[] = [
  { label: 'Manual only',   type: 'manual' },
  { label: 'Every 5 min',   type: 'schedule', cron: '*/5 * * * *' },
  { label: 'Every 15 min',  type: 'schedule', cron: '*/15 * * * *' },
  { label: 'Hourly',        type: 'schedule', cron: '0 * * * *' },
  { label: 'Every 6 hours', type: 'schedule', cron: '0 */6 * * *' },
  { label: 'Daily 9 AM',    type: 'schedule', cron: '0 9 * * *' },
  { label: 'Weekly Mon',    type: 'schedule', cron: '0 9 * * 1' },
  { label: 'On webhook',    type: 'webhook' },
];

// -- Use Case Categories ---------------------------------------------

export const USE_CASE_CATEGORIES = [
  { value: 'notification',   label: 'Notification' },
  { value: 'data-sync',      label: 'Data Sync' },
  { value: 'monitoring',     label: 'Monitoring' },
  { value: 'automation',     label: 'Automation' },
  { value: 'communication',  label: 'Communication' },
  { value: 'reporting',      label: 'Reporting' },
] as const;

// -- Error Strategies ------------------------------------------------

export const ERROR_STRATEGIES = [
  { value: 'halt',                  label: 'Halt',                  description: 'Stop immediately on error' },
  { value: 'retry-once',            label: 'Retry once',            description: 'Retry once, then halt' },
  { value: 'retry-3x',             label: 'Retry 3x',             description: 'Retry up to 3x with backoff' },
  { value: 'notify-and-continue',  label: 'Notify & continue',    description: 'Log error, notify, continue' },
  { value: 'skip',                  label: 'Skip',                  description: 'Skip failed step' },
] as const;

// -- Review Policies -------------------------------------------------

export const REVIEW_POLICIES = [
  { value: 'never',            label: 'Fully autonomous',    description: 'No manual review needed' },
  { value: 'persona-decides',  label: 'Let Persona decide',  description: 'Persona decides when review is needed' },
  { value: 'on-error',         label: 'On error',            description: 'Review when errors occur' },
  { value: 'on-first-run',     label: 'First run',           description: 'Review first execution only' },
  { value: 'always',           label: 'Always',              description: 'Every execution needs approval' },
] as const;

// -- Channel Types ---------------------------------------------------

export const CHANNEL_TYPES: Array<{
  type: NotificationChannelType;
  label: string;
  configFields: Array<{ key: string; label: string; placeholder: string }>;
}> = [
  { type: 'slack',    label: 'Slack',    configFields: [{ key: 'channel', label: 'Channel', placeholder: '#general' }] },
  { type: 'telegram', label: 'Telegram', configFields: [{ key: 'chat_id', label: 'Chat ID', placeholder: '123456789' }] },
  { type: 'email',    label: 'Email',    configFields: [{ key: 'to', label: 'To Address', placeholder: 'user@example.com' }] },
];

// -- Component Roles -------------------------------------------------

export type ComponentRole = 'retrieve' | 'store' | 'act' | 'notify';

export const COMPONENT_ROLES: Array<{
  role: ComponentRole;
  label: string;
  description: string;
}> = [
  { role: 'retrieve', label: 'Retrieve',  description: 'Fetch data from sources' },
  { role: 'store',    label: 'Store',     description: 'Save and organize data' },
  { role: 'act',      label: 'Act',       description: 'Execute actions' },
  { role: 'notify',   label: 'Notify',    description: 'Send alerts & messages' },
];

// -- Builder Component (role + connector + credential) ---------------

export interface BuilderComponent {
  id: string;
  role: ComponentRole;
  connectorName: string;
  credentialId: string | null;
  watchedTables?: string[];
}

// -- Builder State ---------------------------------------------------

export interface BuilderState {
  intent: string;
  useCases: BuilderUseCase[];
  components: BuilderComponent[];
  globalTrigger: TriggerPreset | null;
  channels: NotificationChannel[];
  errorStrategy: string;
  reviewPolicy: string;
}

export const INITIAL_BUILDER_STATE: BuilderState = {
  intent: '',
  useCases: [],
  components: [
    { id: 'default_notify', role: 'notify', connectorName: 'in-app-messaging', credentialId: null },
  ],
  globalTrigger: null,
  channels: [],
  errorStrategy: 'halt',
  reviewPolicy: 'never',
};

// -- Credential Coverage ---------------------------------------------

export type CoverageStatus = 'full' | 'partial' | 'none';

export interface CredentialCoverage {
  total: number;
  matched: number;
  status: CoverageStatus;
}

// -- Dry Run ---------------------------------------------------------

export interface DryRunIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  proposal: DryRunProposal | null;
  resolved: boolean;
}

export interface DryRunProposal {
  label: string;
  actions: import('./builderReducer').BuilderAction[];
}

export interface DryRunResult {
  status: 'ready' | 'partial' | 'blocked';
  capabilities: string[];
  issues: DryRunIssue[];
}
