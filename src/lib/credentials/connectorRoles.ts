/** Functional role grouping for connector interchangeability */
export interface ConnectorRole {
  role: string;
  label: string;
  members: string[];
}

/**
 * Registry of connector functional roles.
 * Connectors sharing a role are interchangeable -- users can swap between them
 * in the adoption wizard and the CLI will adjust the persona accordingly.
 */
export const CONNECTOR_ROLES: ConnectorRole[] = [
  // -- Communication ---------------------------------------------
  { role: 'chat_messaging',      label: 'Chat & Messaging',     members: ['slack', 'discord', 'telegram', 'microsoft_teams', 'gmail', 'microsoft_outlook', 'personas_messages'] },
  { role: 'email_delivery',      label: 'Email Delivery',       members: ['sendgrid', 'resend', 'mailchimp'] },
  { role: 'sms',                 label: 'SMS',                  members: ['twilio_sms', 'twilio'] },

  // -- Development -----------------------------------------------
  { role: 'source_control',      label: 'Source Control',       members: ['github', 'gitlab', 'azure_devops'] },
  { role: 'ci_cd',               label: 'CI/CD',                members: ['circleci', 'gitlab', 'azure_devops'] },
  { role: 'project_tracking',    label: 'Project Tracking',     members: ['jira', 'linear', 'clickup', 'monday_com', 'monday', 'asana', 'trello', 'todoist'] },
  { role: 'knowledge_base',      label: 'Knowledge Base',       members: ['confluence', 'airtable', 'coda'] },
  { role: 'design',              label: 'Design',               members: ['figma', 'canva', 'penpot'] },
  { role: 'feature_flags',       label: 'Feature Flags',        members: ['launchdarkly', 'posthog'] },

  // -- Infrastructure --------------------------------------------
  { role: 'hosting',             label: 'Hosting & Deploy',     members: ['vercel', 'netlify', 'cloudflare'] },
  { role: 'cloud_infra',         label: 'Cloud Infrastructure', members: ['aws', 'firebase', 'kubernetes'] },
  { role: 'database',            label: 'Database',             members: ['personas_database', 'personas_vector_db', 'supabase', 'neon', 'convex', 'planetscale', 'upstash', 'postgres_proxy', 'postgres', 'mongodb', 'redis', 'duckdb', 'notion', 'google_sheets'] },
  { role: 'cloud_storage',       label: 'Cloud Storage',        members: ['dropbox', 'onedrive', 'sharepoint', 'aws_s3', 'cloudflare_r2', 'backblaze_b2'] },

  // -- Monitoring & Security -------------------------------------
  { role: 'error_monitoring',    label: 'Error Monitoring',     members: ['sentry', 'betterstack'] },
  { role: 'incident_management', label: 'Incident Management',  members: ['pagerduty', 'datadog'] },
  { role: 'uptime_monitoring',   label: 'Uptime Monitoring',    members: ['uptime_robot', 'betterstack'] },
  { role: 'security_scanning',   label: 'Security Scanning',    members: ['snyk'] },

  // -- Analytics & Data ------------------------------------------
  { role: 'analytics',           label: 'Product Analytics',    members: ['mixpanel', 'posthog', 'twilio_segment', 'amplitude', 'google_analytics', 'segment'] },
  { role: 'spreadsheet',         label: 'Spreadsheets',         members: ['google_sheets', 'microsoft_excel', 'airtable'] },

  // -- Customer-Facing -------------------------------------------
  { role: 'crm',                 label: 'CRM',                  members: ['hubspot', 'intercom', 'pipedrive', 'attio'] },
  { role: 'support_ticketing',   label: 'Support Ticketing',    members: ['zendesk', 'freshdesk', 'intercom', 'crisp'] },
  { role: 'social_media',        label: 'Social Media',         members: ['buffer', 'linkedin', 'twitter'] },

  // -- Content & CMS ---------------------------------------------
  { role: 'cms',                 label: 'CMS',                  members: ['wordpress', 'webflow', 'contentful'] },
  { role: 'search_engine',       label: 'Search Engine',        members: ['algolia'] },
  { role: 'video_comms',         label: 'Video & Comms',        members: ['loom'] },

  // -- Finance & Commerce ----------------------------------------
  { role: 'payment_processing',  label: 'Payment Processing',   members: ['stripe', 'paddle'] },
  { role: 'accounting',          label: 'Accounting',           members: ['quickbooks', 'xero'] },
  { role: 'banking_fintech',     label: 'Banking & Fintech',    members: ['plaid'] },
  { role: 'e_commerce',          label: 'E-Commerce',           members: ['shopify', 'shipstation', 'woocommerce', 'lemonsqueezy'] },

  // -- Scheduling & Forms ----------------------------------------
  { role: 'scheduling',          label: 'Scheduling',           members: ['calendly', 'cal_com', 'google_calendar', 'microsoft_calendar'] },
  { role: 'form_survey',         label: 'Forms & Surveys',      members: ['typeform', 'tally', 'formbricks'] },
  { role: 'notifications',       label: 'Notifications',        members: ['novu', 'knock', 'ntfy'] },

  // -- Specialty -------------------------------------------------
  { role: 'auth_identity',       label: 'Auth & Identity',      members: ['clerk'] },
  { role: 'ai_platform',         label: 'AI Platform',          members: ['openai', 'leonardo_ai'] },
  { role: 'advertising',         label: 'Advertising',          members: ['google_ads'] },
  { role: 'e_signature',         label: 'E-Signature',          members: ['docusign'] },
  { role: 'hr_recruiting',       label: 'HR & Recruiting',      members: ['greenhouse'] },

  // -- Desktop Apps --------------------------------------------
  { role: 'code_editor',         label: 'Code Editor',          members: ['desktop_vscode'] },
  { role: 'container_runtime',   label: 'Container Runtime',    members: ['desktop_docker'] },
  { role: 'shell',               label: 'Shell / Terminal',     members: ['desktop_terminal'] },
  { role: 'note_taking',         label: 'Note Taking',          members: ['desktop_obsidian', 'obsidian'] },
  { role: 'browser_automation',  label: 'Browser Automation',   members: ['desktop_browser'] },
];

// -- Purpose groups: architectural-level categorisation of roles --------

export interface PurposeGroup {
  purpose: string;
  label: string;
  roles: string[];
}

/**
 * Purpose groups map to architectural component keys from connector-categories.json.
 * The `purpose` field uses the same keys as arch components for easy cross-referencing.
 */
export const PURPOSE_GROUPS: PurposeGroup[] = [
  { purpose: 'messaging',      label: 'Messaging',           roles: ['chat_messaging'] },
  { purpose: 'email',          label: 'Email / SMS',         roles: ['email_delivery', 'sms'] },
  { purpose: 'notifications',  label: 'Notifications',       roles: ['notifications'] },
  { purpose: 'devops',         label: 'DevOps / CI-CD',      roles: ['source_control', 'ci_cd', 'feature_flags', 'auth_identity', 'code_editor', 'container_runtime', 'shell', 'browser_automation'] },
  { purpose: 'project-mgmt',   label: 'Project Mgmt',        roles: ['project_tracking'] },
  { purpose: 'productivity',   label: 'Productivity',         roles: ['knowledge_base', 'search_engine', 'video_comms', 'note_taking', 'e_signature'] },
  { purpose: 'design',         label: 'Design',              roles: ['design'] },
  { purpose: 'cloud',          label: 'Cloud',               roles: ['hosting', 'cloud_infra'] },
  { purpose: 'database',       label: 'Database',            roles: ['database', 'spreadsheet'] },
  { purpose: 'storage',        label: 'Storage',             roles: ['cloud_storage'] },
  { purpose: 'monitoring',     label: 'Monitoring',          roles: ['error_monitoring', 'incident_management', 'uptime_monitoring', 'security_scanning'] },
  { purpose: 'analytics',      label: 'Analytics',           roles: ['analytics'] },
  { purpose: 'crm',            label: 'CRM',                 roles: ['crm', 'hr_recruiting'] },
  { purpose: 'support',        label: 'Support',             roles: ['support_ticketing'] },
  { purpose: 'social',         label: 'Social',              roles: ['social_media', 'advertising'] },
  { purpose: 'cms',            label: 'CMS',                 roles: ['cms'] },
  { purpose: 'finance',        label: 'Finance',             roles: ['payment_processing', 'accounting', 'banking_fintech'] },
  { purpose: 'ecommerce',      label: 'E-Commerce',          roles: ['e_commerce'] },
  { purpose: 'scheduling',     label: 'Scheduling',          roles: ['scheduling'] },
  { purpose: 'forms',          label: 'Forms',               roles: ['form_survey'] },
  { purpose: 'ai',             label: 'AI',                  roles: ['ai_platform'] },
];

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
  label: string;
  members: string[];
  recommended: string;
}

/** Build an ArchitectureComponent for a connector, marking it as the recommended choice */
export function getArchitectureComponent(connectorName: string): ArchitectureComponent | undefined {
  const role = getRoleForConnector(connectorName);
  if (!role) return undefined;
  return { role: role.role, label: role.label, members: role.members, recommended: connectorName };
}
