/**
 * Patches all template JSON files to populate `role` and `category` on
 * each suggested_connector entry.  Run once, commit results.
 *
 *   node scripts/fix-template-connectors.mjs
 */
import fs from 'fs';
import path from 'path';

// ── Connector → role mapping ────────────────────────────────────
const CONNECTOR_ROLE = {
  // Chat & Messaging
  slack: 'chat_messaging', discord: 'chat_messaging', telegram: 'chat_messaging',
  // Email
  sendgrid: 'email_delivery', resend: 'email_delivery', mailchimp: 'email_delivery',
  // SMS
  twilio_sms: 'sms', twilio: 'sms',
  // Source Control
  github: 'source_control', gitlab: 'source_control',
  // CI/CD
  circleci: 'ci_cd',
  // Project Tracking
  jira: 'project_tracking', linear: 'project_tracking', clickup: 'project_tracking',
  monday_com: 'project_tracking', asana: 'project_tracking', trello: 'project_tracking',
  todoist: 'project_tracking',
  // Knowledge Base
  notion: 'knowledge_base', confluence: 'knowledge_base', airtable: 'knowledge_base',
  coda: 'knowledge_base',
  // Design
  figma: 'design',
  // Feature Flags
  launchdarkly: 'feature_flags', posthog: 'feature_flags',
  // Hosting & Deploy
  vercel: 'hosting', netlify: 'hosting', cloudflare: 'hosting',
  // Cloud Infrastructure
  aws: 'cloud_infra', firebase: 'cloud_infra',
  // Database
  supabase: 'database', neon: 'database', convex: 'database',
  planetscale: 'database', upstash: 'database', postgres_proxy: 'database',
  // Cloud Storage
  dropbox: 'cloud_storage',
  // Error Monitoring
  sentry: 'error_monitoring', betterstack: 'error_monitoring',
  // Incident Management
  pagerduty: 'incident_management', datadog: 'incident_management',
  // Uptime
  uptime_robot: 'uptime_monitoring',
  // Security
  snyk: 'security_scanning',
  // Analytics
  mixpanel: 'analytics', twilio_segment: 'analytics', amplitude: 'analytics',
  google_analytics: 'analytics', segment: 'analytics',
  // Spreadsheets
  google_sheets: 'spreadsheet',
  // CRM
  hubspot: 'crm', intercom: 'crm',
  // Support
  zendesk: 'support_ticketing', freshdesk: 'support_ticketing',
  // Social
  buffer: 'social_media', twitter: 'social_media',
  // CMS
  wordpress: 'cms', webflow: 'cms', contentful: 'cms',
  // Search
  algolia: 'search_engine',
  // Video
  loom: 'video_comms',
  // Payments
  stripe: 'payment_processing', paddle: 'payment_processing',
  // Accounting
  quickbooks: 'accounting', xero: 'accounting',
  // Banking
  plaid: 'banking_fintech',
  // E-Commerce
  shopify: 'e_commerce', shipstation: 'e_commerce',
  // Scheduling
  calendly: 'scheduling',
  // Forms
  typeform: 'form_survey',
  // Auth
  clerk: 'auth_identity',
  // AI
  openai: 'ai_platform',
  // Advertising
  google_ads: 'advertising',
  // E-Signature
  docusign: 'e_signature',
  // HR
  greenhouse: 'hr_recruiting',
  // Google Workspace
  google_workspace: 'productivity_suite',
};

// ── Connector → catalog category ────────────────────────────────
const CONNECTOR_CATEGORY = {
  slack: 'messaging', discord: 'messaging', telegram: 'messaging',
  sendgrid: 'messaging', resend: 'messaging', mailchimp: 'messaging',
  twilio_sms: 'messaging', twilio: 'messaging',
  github: 'development', gitlab: 'development', linear: 'development',
  jira: 'development', circleci: 'development',
  clickup: 'productivity', asana: 'productivity', trello: 'productivity',
  monday_com: 'productivity', todoist: 'productivity',
  notion: 'productivity', confluence: 'productivity', airtable: 'productivity',
  coda: 'productivity', google_workspace: 'productivity', google_sheets: 'productivity',
  figma: 'creativity', loom: 'creativity',
  vercel: 'devops', netlify: 'devops', cloudflare: 'devops',
  aws: 'devops', firebase: 'devops',
  supabase: 'database', neon: 'database', convex: 'database',
  planetscale: 'database', upstash: 'database', postgres_proxy: 'database',
  sentry: 'monitoring', betterstack: 'monitoring', datadog: 'monitoring',
  pagerduty: 'monitoring', uptime_robot: 'monitoring', snyk: 'monitoring',
  mixpanel: 'analytics', posthog: 'analytics', amplitude: 'analytics',
  google_analytics: 'analytics', segment: 'analytics', twilio_segment: 'analytics',
  hubspot: 'crm', intercom: 'crm',
  zendesk: 'support', freshdesk: 'support',
  buffer: 'social', twitter: 'social',
  dropbox: 'storage',
  wordpress: 'cms', webflow: 'cms', contentful: 'cms',
  algolia: 'search',
  launchdarkly: 'development',
  stripe: 'finance', paddle: 'finance', quickbooks: 'finance',
  xero: 'finance', plaid: 'finance',
  shopify: 'e-commerce', shipstation: 'e-commerce',
  calendly: 'scheduling',
  typeform: 'forms',
  clerk: 'auth',
  openai: 'ai',
  google_ads: 'marketing',
  docusign: 'legal',
  greenhouse: 'hr',
};

// ── Walk & patch ────────────────────────────────────────────────

function walkDir(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!file.startsWith('_')) results = results.concat(walkDir(full));
    } else if (file.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

const files = walkDir('scripts/templates');
let patchedFiles = 0;
let patchedConnectors = 0;

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const connectors = data.payload?.suggested_connectors;
  if (!Array.isArray(connectors) || connectors.length === 0) continue;

  let changed = false;
  for (const c of connectors) {
    const name = c.name;
    const newRole = CONNECTOR_ROLE[name];
    const newCat = CONNECTOR_CATEGORY[name];
    if (newRole && c.role !== newRole) {
      c.role = newRole;
      changed = true;
      patchedConnectors++;
    }
    if (newCat && c.category !== newCat) {
      c.category = newCat;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n', 'utf8');
    patchedFiles++;
    console.log(`Patched: ${path.relative('.', f)}`);
  }
}

console.log(`\nDone. Patched ${patchedConnectors} connectors in ${patchedFiles} files.`);
