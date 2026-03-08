import {
  MessageSquare,
  Database,
  Users,
  Kanban,
  Code2,
  Activity,
  BarChart3,
  Mail,
  CreditCard,
  LifeBuoy,
  Share2,
  ShoppingBag,
  Calendar,
  FileText,
  Cloud,
  Layout,
  Bot,
  Globe,
  type LucideIcon,
} from 'lucide-react';

// ── Architectural categories ─────────────────────────────────────
// Maps connector names to high-level architectural categories.
// These categories match the section headers from ConnectorMeta.tsx.

export interface ArchCategory {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const ARCH_CATEGORIES: Record<string, ArchCategory> = {
  messaging:     { key: 'messaging',     label: 'Messaging',      icon: MessageSquare, color: '#6366f1' },
  database:      { key: 'database',      label: 'Database',       icon: Database,      color: '#06b6d4' },
  crm:           { key: 'crm',           label: 'CRM',            icon: Users,         color: '#f97316' },
  'project-mgmt':{ key: 'project-mgmt',  label: 'Project Mgmt',   icon: Kanban,        color: '#0ea5e9' },
  devops:        { key: 'devops',         label: 'DevOps / CI-CD', icon: Code2,         color: '#8b5cf6' },
  monitoring:    { key: 'monitoring',     label: 'Monitoring',     icon: Activity,      color: '#14b8a6' },
  analytics:     { key: 'analytics',      label: 'Analytics',      icon: BarChart3,     color: '#7856FF' },
  email:         { key: 'email',          label: 'Email / SMS',    icon: Mail,          color: '#ef4444' },
  finance:       { key: 'finance',        label: 'Finance',        icon: CreditCard,    color: '#10b981' },
  support:       { key: 'support',        label: 'Support',        icon: LifeBuoy,      color: '#0891b2' },
  social:        { key: 'social',         label: 'Social',         icon: Share2,        color: '#ec4899' },
  ecommerce:     { key: 'ecommerce',      label: 'E-Commerce',     icon: ShoppingBag,   color: '#7AB55C' },
  scheduling:    { key: 'scheduling',     label: 'Scheduling',     icon: Calendar,      color: '#006BFF' },
  productivity:  { key: 'productivity',   label: 'Productivity',   icon: FileText,      color: '#eab308' },
  cloud:         { key: 'cloud',          label: 'Cloud',          icon: Cloud,         color: '#3b82f6' },
  design:        { key: 'design',         label: 'Design',         icon: Layout,        color: '#F24E1E' },
  ai:            { key: 'ai',             label: 'AI',             icon: Bot,           color: '#6C3AEF' },
  cms:           { key: 'cms',            label: 'CMS',            icon: Globe,         color: '#4353FF' },
};

/** Maps a connector name to its architectural category key. */
const CONNECTOR_TO_CATEGORY: Record<string, string> = {
  // Messaging
  slack: 'messaging', discord: 'messaging', telegram: 'messaging',
  personas_messages: 'messaging', 'in-app-messaging': 'messaging',
  personas_database: 'database',
  // Source Control & DevOps
  github: 'devops', gitlab: 'devops', azure_devops: 'devops',
  circleci: 'devops', github_actions: 'devops',
  // Project Management
  jira: 'project-mgmt', linear: 'project-mgmt', clickup: 'project-mgmt',
  asana: 'project-mgmt', trello: 'project-mgmt', monday: 'project-mgmt',
  monday_com: 'project-mgmt', todoist: 'project-mgmt',
  // Productivity / Knowledge
  notion: 'productivity', confluence: 'productivity', airtable: 'productivity',
  coda: 'productivity', google_drive: 'productivity', google_sheets: 'productivity',
  google_workspace: 'productivity', dropbox: 'productivity',
  // Design
  figma: 'design',
  // Cloud & DevOps
  vercel: 'cloud', netlify: 'cloud', cloudflare: 'cloud', aws: 'cloud',
  firebase: 'cloud', kubernetes: 'cloud',
  // Database
  supabase: 'database', neon: 'database', postgres_proxy: 'database',
  convex: 'database', upstash: 'database',
  // Monitoring
  sentry: 'monitoring', datadog: 'monitoring', pagerduty: 'monitoring',
  betterstack: 'monitoring', uptime_robot: 'monitoring', snyk: 'monitoring',
  // Analytics
  mixpanel: 'analytics', posthog: 'analytics', amplitude: 'analytics',
  segment: 'analytics', google_analytics: 'analytics',
  // Email / SMS
  gmail: 'email', sendgrid: 'email', mailchimp: 'email', twilio: 'email',
  // CRM
  hubspot: 'crm', intercom: 'crm',
  // Support
  zendesk: 'support', freshdesk: 'support',
  // Social
  buffer: 'social', linkedin: 'social', twitter: 'social',
  // E-Commerce
  shopify: 'ecommerce', shipstation: 'ecommerce',
  // Finance
  stripe: 'finance', paddle: 'finance', quickbooks: 'finance',
  xero: 'finance', plaid: 'finance',
  // Scheduling
  google_calendar: 'scheduling', cal_com: 'scheduling', calendly: 'scheduling',
  // CMS
  wordpress: 'cms', webflow: 'cms', contentful: 'cms',
  // AI
  leonardo_ai: 'ai', openai: 'ai', replicate: 'ai',
  // Search
  algolia: 'productivity',
  // Video
  loom: 'productivity',
  // Feature Flags
  launchdarkly: 'devops',
  // Legal
  docusign: 'productivity',
  // Auth
  clerk: 'devops',
  // HR
  greenhouse: 'crm',
  // Forms
  typeform: 'productivity',
  // Marketing
  google_ads: 'social',
  // Automation
  n8n: 'devops', zapier: 'devops',
  // Generic
  http: 'cloud',
};

/** Get the architectural category for a connector name. */
export function getArchCategory(connectorName: string): ArchCategory {
  const key = CONNECTOR_TO_CATEGORY[connectorName];
  if (key && ARCH_CATEGORIES[key]) return ARCH_CATEGORIES[key];
  return { key: 'other', label: 'Other', icon: Globe, color: '#71717a' };
}

/** Derive unique architectural categories from a list of connector names. */
export function deriveArchCategories(connectors: string[]): ArchCategory[] {
  const seen = new Set<string>();
  const result: ArchCategory[] = [];
  for (const c of connectors) {
    const cat = getArchCategory(c);
    if (!seen.has(cat.key)) {
      seen.add(cat.key);
      result.push(cat);
    }
  }
  return result;
}

/**
 * Check if user has ANY credential in a given architectural category.
 * @param categoryKey - e.g. 'messaging'
 * @param userCredentialServiceTypes - Set of service_type strings user has credentials for
 */
export function userHasCategoryCredential(
  categoryKey: string,
  userCredentialServiceTypes: Set<string>,
): boolean {
  // Built-in components — always available without external credentials
  if (categoryKey === 'messaging') return true;  // in-app messaging
  if (categoryKey === 'database') return true;   // built-in SQLite database

  for (const [connector, cat] of Object.entries(CONNECTOR_TO_CATEGORY)) {
    if (cat === categoryKey && userCredentialServiceTypes.has(connector)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute category-level readiness for a template.
 * Returns { total, ready } counts.
 */
export function computeCategoryReadiness(
  connectors: string[],
  userCredentialServiceTypes: Set<string>,
): { total: number; ready: number } {
  const categories = deriveArchCategories(connectors);
  let ready = 0;
  for (const cat of categories) {
    if (userHasCategoryCredential(cat.key, userCredentialServiceTypes)) {
      ready++;
    }
  }
  return { total: categories.length, ready };
}
