import type { Translations } from '@/i18n/en';

/** Functional role grouping for connector interchangeability */
export interface ConnectorRole {
  role: string;
  /** i18n key inside `connector_roles` — resolve via `resolveRoleLabel()` or `t.connector_roles[role]`. */
  labelKey: string;
  /** Pre-resolved English label (kept for backward compatibility). */
  label: string;
  members: string[];
}

// English defaults used both as `label` fallback and to seed the i18n bundle.
const ROLE_LABELS: Record<string, string> = {
  chat_messaging: 'Chat & Messaging',
  email_delivery: 'Email Delivery',
  sms: 'SMS',
  source_control: 'Source Control',
  ci_cd: 'CI/CD',
  project_tracking: 'Project Tracking',
  knowledge_base: 'Knowledge Base',
  design: 'Design',
  feature_flags: 'Feature Flags',
  hosting: 'Hosting & Deploy',
  cloud_infra: 'Cloud Infrastructure',
  database: 'Database',
  cloud_storage: 'Cloud Storage',
  error_monitoring: 'Error Monitoring',
  incident_management: 'Incident Management',
  uptime_monitoring: 'Uptime Monitoring',
  security_scanning: 'Security Scanning',
  analytics: 'Product Analytics',
  spreadsheet: 'Spreadsheets',
  crm: 'CRM',
  support_ticketing: 'Support Ticketing',
  social_media: 'Social Media',
  cms: 'CMS',
  search_engine: 'Search Engine',
  video_comms: 'Video & Comms',
  payment_processing: 'Payment Processing',
  accounting: 'Accounting',
  banking_fintech: 'Banking & Fintech',
  market_data: 'Market Data',
  e_commerce: 'E-Commerce',
  scheduling: 'Scheduling',
  form_survey: 'Forms & Surveys',
  notifications: 'Notifications',
  auth_identity: 'Auth & Identity',
  ai_platform: 'AI Platform',
  advertising: 'Advertising',
  e_signature: 'E-Signature',
  hr_recruiting: 'HR & Recruiting',
  tool_gateway: 'Tool Gateway',
  code_editor: 'Code Editor',
  container_runtime: 'Container Runtime',
  shell: 'Shell / Terminal',
  note_taking: 'Note Taking',
  browser_automation: 'Browser Automation',
  time_tracking: 'Time Tracking',
};

/** Helper to build a ConnectorRole entry with both labelKey and fallback label. */
function role(key: string, members: string[]): ConnectorRole {
  return { role: key, labelKey: key, label: ROLE_LABELS[key] ?? key, members };
}

/**
 * Registry of connector functional roles.
 * Connectors sharing a role are interchangeable -- users can swap between them
 * in the adoption wizard and the CLI will adjust the persona accordingly.
 */
export const CONNECTOR_ROLES: ConnectorRole[] = [
  // -- Communication ---------------------------------------------
  role('chat_messaging',      ['slack', 'discord', 'telegram', 'microsoft_teams', 'gmail', 'microsoft_outlook', 'personas_messages']),
  role('email_delivery',      ['sendgrid', 'resend', 'mailchimp']),
  role('sms',                 ['twilio_sms', 'twilio']),

  // -- Development -----------------------------------------------
  role('source_control',      ['github', 'gitlab', 'azure_devops']),
  role('ci_cd',               ['circleci', 'gitlab', 'azure_devops']),
  role('project_tracking',    ['jira', 'linear', 'clickup', 'monday_com', 'monday', 'asana', 'trello', 'todoist']),
  role('knowledge_base',      ['confluence', 'airtable', 'coda']),
  role('design',              ['figma', 'canva', 'penpot']),
  role('feature_flags',       ['launchdarkly', 'posthog']),

  // -- Infrastructure --------------------------------------------
  role('hosting',             ['vercel', 'netlify', 'cloudflare']),
  role('cloud_infra',         ['aws', 'firebase', 'kubernetes']),
  role('database',            ['personas_database', 'personas_vector_db', 'supabase', 'neon', 'convex', 'planetscale', 'upstash', 'postgres_proxy', 'postgres', 'mongodb', 'redis', 'duckdb', 'notion', 'google_sheets']),
  role('cloud_storage',       ['dropbox', 'onedrive', 'sharepoint', 'aws_s3', 'cloudflare_r2', 'backblaze_b2']),

  // -- Monitoring & Security -------------------------------------
  role('error_monitoring',    ['sentry', 'betterstack']),
  role('incident_management', ['pagerduty', 'datadog']),
  role('uptime_monitoring',   ['uptime_robot', 'betterstack']),
  role('security_scanning',   ['snyk']),

  // -- Analytics & Data ------------------------------------------
  role('analytics',           ['mixpanel', 'posthog', 'twilio_segment', 'amplitude', 'google_analytics', 'segment']),
  role('spreadsheet',         ['google_sheets', 'microsoft_excel', 'airtable']),

  // -- Customer-Facing -------------------------------------------
  role('crm',                 ['hubspot', 'intercom', 'pipedrive', 'attio']),
  role('support_ticketing',   ['zendesk', 'freshdesk', 'intercom', 'crisp']),
  role('social_media',        ['buffer', 'linkedin', 'reddit', 'twitter', 'x_twitter', 'youtube_data']),

  // -- Content & CMS ---------------------------------------------
  role('cms',                 ['wordpress', 'webflow', 'contentful']),
  role('search_engine',       ['algolia']),
  role('video_comms',         ['loom']),

  // -- Finance & Commerce ----------------------------------------
  role('payment_processing',  ['stripe', 'paddle']),
  role('accounting',          ['quickbooks', 'xero']),
  role('banking_fintech',     ['plaid', 'ramp']),
  role('market_data',         ['alpha_vantage']),
  role('e_commerce',          ['shopify', 'shipstation', 'woocommerce', 'lemonsqueezy']),

  // -- Scheduling & Forms ----------------------------------------
  role('scheduling',          ['calendly', 'cal_com', 'google_calendar', 'microsoft_calendar']),
  role('time_tracking',       ['clockify', 'toggl', 'harvest']),
  role('form_survey',         ['typeform', 'tally', 'formbricks']),
  role('notifications',       ['novu', 'knock', 'ntfy']),

  // -- Specialty -------------------------------------------------
  role('auth_identity',       ['clerk']),
  role('ai_platform',         ['openai', 'google_gemini', 'leonardo_ai', 'elevenlabs', 'deepgram']),
  role('advertising',         ['google_ads']),
  role('e_signature',         ['docusign']),
  role('hr_recruiting',       ['greenhouse']),

  // -- Integration Hubs ------------------------------------------
  role('tool_gateway',        ['mcp_gateway', 'arcade']),

  // -- Desktop Apps --------------------------------------------
  role('code_editor',         ['desktop_vscode']),
  role('container_runtime',   ['desktop_docker']),
  role('shell',               ['desktop_terminal']),
  role('note_taking',         ['desktop_obsidian', 'obsidian']),
  role('browser_automation',  ['desktop_browser', 'apify']),
];

/**
 * Resolve a connector role label using the active translation bundle.
 * Falls back to the English default when no bundle is provided.
 */
export function resolveRoleLabel(r: ConnectorRole, t?: Translations): string {
  const section = t?.connector_roles as Record<string, string> | undefined;
  return section?.[r.labelKey] ?? r.label;
}

// -- Purpose groups: architectural-level categorisation of roles --------

export interface PurposeGroup {
  purpose: string;
  /** i18n key inside `connector_roles` (prefixed with `purpose_`) — resolve via `resolvePurposeLabel()`. */
  labelKey: string;
  /** Pre-resolved English label (kept for backward compatibility). */
  label: string;
  roles: string[];
}

// English defaults for purpose group labels.
const PURPOSE_LABELS: Record<string, string> = {
  messaging: 'Messaging',
  email: 'Email / SMS',
  notifications: 'Notifications',
  devops: 'DevOps / CI-CD',
  'project-mgmt': 'Project Mgmt',
  productivity: 'Productivity',
  design: 'Design',
  cloud: 'Cloud',
  database: 'Database',
  storage: 'Storage',
  monitoring: 'Monitoring',
  analytics: 'Analytics',
  crm: 'CRM',
  support: 'Support',
  social: 'Social',
  cms: 'CMS',
  finance: 'Finance',
  ecommerce: 'E-Commerce',
  scheduling: 'Scheduling',
  forms: 'Forms',
  ai: 'AI',
  'time-tracking': 'Time Tracking',
};

/** Convert a purpose key to the i18n key used in `connector_roles`. */
function purposeI18nKey(purpose: string): string {
  return `purpose_${purpose.replace('-', '_')}`;
}

/** Helper to build a PurposeGroup entry with both labelKey and fallback label. */
function purposeGroup(purpose: string, roles: string[]): PurposeGroup {
  return { purpose, labelKey: purposeI18nKey(purpose), label: PURPOSE_LABELS[purpose] ?? purpose, roles };
}

/**
 * Purpose groups map to architectural component keys from connector-categories.json.
 * The `purpose` field uses the same keys as arch components for easy cross-referencing.
 */
export const PURPOSE_GROUPS: PurposeGroup[] = [
  purposeGroup('messaging',      ['chat_messaging']),
  purposeGroup('email',          ['email_delivery', 'sms']),
  purposeGroup('notifications',  ['notifications']),
  purposeGroup('devops',         ['source_control', 'ci_cd', 'feature_flags', 'auth_identity', 'code_editor', 'container_runtime', 'shell', 'browser_automation']),
  purposeGroup('project-mgmt',   ['project_tracking']),
  purposeGroup('productivity',   ['knowledge_base', 'search_engine', 'video_comms', 'note_taking', 'e_signature']),
  purposeGroup('design',         ['design']),
  purposeGroup('cloud',          ['hosting', 'cloud_infra']),
  purposeGroup('database',       ['database', 'spreadsheet']),
  purposeGroup('storage',        ['cloud_storage']),
  purposeGroup('monitoring',     ['error_monitoring', 'incident_management', 'uptime_monitoring', 'security_scanning']),
  purposeGroup('analytics',      ['analytics']),
  purposeGroup('crm',            ['crm', 'hr_recruiting']),
  purposeGroup('support',        ['support_ticketing']),
  purposeGroup('social',         ['social_media', 'advertising']),
  purposeGroup('cms',            ['cms']),
  purposeGroup('finance',        ['payment_processing', 'accounting', 'banking_fintech', 'market_data']),
  purposeGroup('ecommerce',      ['e_commerce']),
  purposeGroup('scheduling',     ['scheduling']),
  purposeGroup('time-tracking',  ['time_tracking']),
  purposeGroup('forms',          ['form_survey']),
  purposeGroup('ai',             ['ai_platform']),
];

/**
 * Resolve a purpose group label using the active translation bundle.
 * Falls back to the English default when no bundle is provided.
 */
export function resolvePurposeLabel(pg: PurposeGroup, t?: Translations): string {
  const section = t?.connector_roles as Record<string, string> | undefined;
  return section?.[pg.labelKey] ?? pg.label;
}

// Pre-computed lookup: connector name -> purpose key
const _connectorPurposeMap = new Map<string, string>();
for (const pg of PURPOSE_GROUPS) {
  for (const roleKey of pg.roles) {
    const role = CONNECTOR_ROLES.find((r) => r.role === roleKey);
    if (role) {
      for (const member of role.members) {
        if (!_connectorPurposeMap.has(member)) {
          _connectorPurposeMap.set(member, pg.purpose);
        }
      }
    }
  }
}

/** Get the architectural purpose key for a connector */
export function getPurposeForConnector(name: string): string | undefined {
  return _connectorPurposeMap.get(name);
}

/** Get the purpose group definition for a connector */
export function getPurposeGroupForConnector(name: string): PurposeGroup | undefined {
  const purpose = _connectorPurposeMap.get(name);
  if (!purpose) return undefined;
  return PURPOSE_GROUPS.find((pg) => pg.purpose === purpose);
}

/** Get the role definition for a connector by name */
export function getRoleForConnector(name: string): ConnectorRole | undefined {
  return CONNECTOR_ROLES.find((r) => r.members.includes(name));
}

/** Get alternative connector names (same role, different name) */
export function getAlternatives(name: string): string[] {
  const role = getRoleForConnector(name);
  if (!role) return [];
  return role.members.filter((m) => m !== name);
}

/** Check if a connector has interchangeable alternatives */
export function hasAlternatives(name: string): boolean {
  return getAlternatives(name).length > 0;
}

/** Architecture component descriptor for the adoption wizard */
export interface ArchitectureComponent {
  role: string;
  /** i18n key inside `connector_roles`. */
  labelKey: string;
  /** Pre-resolved English label (kept for backward compatibility). */
  label: string;
  members: string[];
  recommended: string;
}

/** Build an ArchitectureComponent for a connector, marking it as the recommended choice */
export function getArchitectureComponent(connectorName: string): ArchitectureComponent | undefined {
  const role = getRoleForConnector(connectorName);
  if (!role) return undefined;
  return { role: role.role, labelKey: role.labelKey, label: role.label, members: role.members, recommended: connectorName };
}
