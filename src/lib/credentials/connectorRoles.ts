/** Functional role grouping for connector interchangeability */
export interface ConnectorRole {
  role: string;
  label: string;
  members: string[];
}

/**
 * Registry of connector functional roles.
 * Connectors sharing a role are interchangeable — users can swap between them
 * in the adoption wizard and the CLI will adjust the persona accordingly.
 */
export const CONNECTOR_ROLES: ConnectorRole[] = [
  // ── Communication ─────────────────────────────────────────────
  { role: 'chat_messaging',      label: 'Chat & Messaging',     members: ['slack', 'discord', 'telegram'] },
  { role: 'email_delivery',      label: 'Email Delivery',       members: ['sendgrid', 'resend', 'mailchimp'] },
  { role: 'sms',                 label: 'SMS',                  members: ['twilio_sms', 'twilio'] },

  // ── Development ───────────────────────────────────────────────
  { role: 'source_control',      label: 'Source Control',       members: ['github', 'gitlab'] },
  { role: 'ci_cd',               label: 'CI/CD',                members: ['circleci', 'gitlab'] },
  { role: 'project_tracking',    label: 'Project Tracking',     members: ['jira', 'linear', 'clickup', 'monday_com', 'asana', 'trello', 'todoist'] },
  { role: 'knowledge_base',      label: 'Knowledge Base',       members: ['notion', 'confluence', 'airtable', 'coda'] },
  { role: 'design',              label: 'Design',               members: ['figma'] },
  { role: 'feature_flags',       label: 'Feature Flags',        members: ['launchdarkly', 'posthog'] },

  // ── Infrastructure ────────────────────────────────────────────
  { role: 'hosting',             label: 'Hosting & Deploy',     members: ['vercel', 'netlify', 'cloudflare'] },
  { role: 'cloud_infra',         label: 'Cloud Infrastructure', members: ['aws', 'firebase'] },
  { role: 'database',            label: 'Database',             members: ['supabase', 'neon', 'convex', 'planetscale', 'upstash', 'postgres_proxy'] },
  { role: 'cloud_storage',       label: 'Cloud Storage',        members: ['dropbox'] },

  // ── Monitoring & Security ─────────────────────────────────────
  { role: 'error_monitoring',    label: 'Error Monitoring',     members: ['sentry', 'betterstack'] },
  { role: 'incident_management', label: 'Incident Management',  members: ['pagerduty', 'datadog'] },
  { role: 'uptime_monitoring',   label: 'Uptime Monitoring',    members: ['uptime_robot', 'betterstack'] },
  { role: 'security_scanning',   label: 'Security Scanning',    members: ['snyk'] },

  // ── Analytics & Data ──────────────────────────────────────────
  { role: 'analytics',           label: 'Product Analytics',    members: ['mixpanel', 'posthog', 'twilio_segment', 'amplitude', 'google_analytics', 'segment'] },
  { role: 'spreadsheet',         label: 'Spreadsheets',         members: ['google_sheets', 'airtable'] },

  // ── Customer-Facing ───────────────────────────────────────────
  { role: 'crm',                 label: 'CRM',                  members: ['hubspot', 'intercom'] },
  { role: 'support_ticketing',   label: 'Support Ticketing',    members: ['zendesk', 'freshdesk', 'intercom'] },
  { role: 'social_media',        label: 'Social Media',         members: ['buffer', 'twitter'] },

  // ── Content & CMS ─────────────────────────────────────────────
  { role: 'cms',                 label: 'CMS',                  members: ['wordpress', 'webflow', 'contentful'] },
  { role: 'search_engine',       label: 'Search Engine',        members: ['algolia'] },
  { role: 'video_comms',         label: 'Video & Comms',        members: ['loom'] },

  // ── Finance & Commerce ────────────────────────────────────────
  { role: 'payment_processing',  label: 'Payment Processing',   members: ['stripe', 'paddle'] },
  { role: 'accounting',          label: 'Accounting',           members: ['quickbooks', 'xero'] },
  { role: 'banking_fintech',     label: 'Banking & Fintech',    members: ['plaid'] },
  { role: 'e_commerce',          label: 'E-Commerce',           members: ['shopify', 'shipstation'] },

  // ── Scheduling & Forms ────────────────────────────────────────
  { role: 'scheduling',          label: 'Scheduling',           members: ['calendly'] },
  { role: 'form_survey',         label: 'Forms & Surveys',      members: ['typeform'] },

  // ── Specialty ─────────────────────────────────────────────────
  { role: 'auth_identity',       label: 'Auth & Identity',      members: ['clerk'] },
  { role: 'ai_platform',         label: 'AI Platform',          members: ['openai'] },
  { role: 'advertising',         label: 'Advertising',          members: ['google_ads'] },
  { role: 'e_signature',         label: 'E-Signature',          members: ['docusign'] },
  { role: 'hr_recruiting',       label: 'HR & Recruiting',      members: ['greenhouse'] },
];

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
