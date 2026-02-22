#!/usr/bin/env node
/**
 * Batch Template Generator (v2)
 *
 * Reads list.md (rich format with service flows, connectors, protocols),
 * constructs design prompts with full connector catalog, spawns Claude CLI
 * to generate DesignAnalysisResult JSON payloads with named connectors and
 * credential fields, and saves as seed-ready JSON files.
 *
 * Usage:
 *   node scripts/generate-templates.mjs                     # Generate all
 *   node scripts/generate-templates.mjs --limit 5           # First 5 only
 *   node scripts/generate-templates.mjs --from 10 --to 20   # Range (inclusive)
 *   node scripts/generate-templates.mjs --ids 1,5,9         # Specific template numbers
 *   node scripts/generate-templates.mjs --skip-existing      # Skip templates with existing JSON
 *   node scripts/generate-templates.mjs --dry-run            # Parse and preview without calling Claude
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ============================================================================
// list.md Parser (v2 — rich format)
// ============================================================================

function parseListMd(filePath) {
  const text = readFileSync(filePath, 'utf-8');
  // Split on horizontal rules (--- with optional surrounding whitespace/CR)
  const sections = text.split(/\r?\n---\r?\n/);
  const templates = [];

  for (const section of sections) {
    // Match: ## N — Service Flow Title  (em-dash, en-dash, or hyphen)
    const headerMatch = section.match(/##\s+(\d+)\s+[—–\-]\s+(.+)/);
    if (!headerMatch) continue;

    const num = parseInt(headerMatch[1], 10);
    const fullTitle = headerMatch[2].trim().replace(/\r$/, '');

    // Extract service flow from title arrows (e.g., "Gmail → Slack → Notion Intake Processor")
    const serviceFlow = [];
    let name = fullTitle;
    if (fullTitle.includes('→')) {
      const arrowParts = fullTitle.split(/\s*→\s*/);
      // All parts except the last are pure service names
      for (let a = 0; a < arrowParts.length - 1; a++) {
        serviceFlow.push(arrowParts[a].trim());
      }
      // Last part: "ServiceName Rest Of Name" — split on first space
      const lastPart = arrowParts[arrowParts.length - 1].trim();
      const spaceIdx = lastPart.indexOf(' ');
      if (spaceIdx > 0) {
        serviceFlow.push(lastPart.substring(0, spaceIdx));
        name = lastPart.substring(spaceIdx + 1).trim();
      } else {
        name = lastPart;
      }
    }

    // Extract description — lines after header, before first **Bold**: line
    const descMatch = section.match(/##[^\n]+\r?\n\r?\n([\s\S]+?)(?=\r?\n\*\*(?:Replaces|Use Case|Tools|Connectors|Triggers|Protocols)\*\*)/);
    const description = descMatch ? descMatch[1].trim().replace(/\r/g, '') : '';

    // Extract metadata fields
    const replaces = extractField(section, 'Replaces');
    const tools = extractField(section, 'Tools');
    const connectors = extractField(section, 'Connectors');
    const trigger = extractField(section, 'Triggers');
    const protocols = extractField(section, 'Protocols');

    // Extract team roles (Pipeline templates: **Use Case A — Name** (role): description)
    const useCases = [];
    const useCaseRegex = /\*\*Use Case ([A-Z])\s*[—–\-]\s*(.+?)\*\*\s*\((\w+)\):\s*(.+)/g;
    let ucMatch;
    while ((ucMatch = useCaseRegex.exec(section)) !== null) {
      useCases.push({
        id: ucMatch[1],
        name: ucMatch[2].trim(),
        role: ucMatch[3].trim(),
        description: ucMatch[4].trim().replace(/\r$/, ''),
      });
    }

    // Derive category from template context
    const category = deriveCategory(name, fullTitle, connectors, tools, useCases, description);

    templates.push({
      num, name, fullTitle, description, serviceFlow,
      replaces, tools, connectors, trigger, protocols,
      category, useCases,
    });
  }

  return templates;
}

function extractField(section, fieldName) {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
  const match = section.match(regex);
  return match ? match[1].trim().replace(/\r$/, '') : '';
}

function deriveCategory(name, fullTitle, connectors, tools, useCases, description) {
  if (useCases.length > 0) return 'Pipeline';

  // Use name primarily (it's the most specific), then fallback to flow/description
  const nameText = name.toLowerCase();
  const titleText = fullTitle.toLowerCase();
  const descText = (description || '').toLowerCase();

  // --- Match on NAME first (most reliable) ---

  // DevOps (infrastructure, monitoring, deployment)
  if (/ssl|uptime|docker|backup|dns|incident|sre|runbook|server|deploy|infrastructure|database health|health sentinel|alert consolidat|status page|infrastructure change|app performance/.test(nameText)) return 'DevOps';
  // Development (code, CI/CD, engineering tools)
  if (/ci[\s/]cd|build intelligence|code review|dependency|release note|api health|log anomal|database migrat|issue dedup|tech debt|feature flag|documentation.*fresh|design handoff|documentation publish|dev lifecycle|engineering|sprint auto|sprint doc|search quality|production quality|pipeline manager/.test(nameText)) return 'Development';
  // Security
  if (/security|vulnerability|credential scan|phishing|leaked|fraud detect|access governance|security.*audit/.test(nameText)) return 'Security';
  // Legal
  if (/contract|privacy policy|gdpr|license compliance|nda|legal/.test(nameText)) return 'Legal';
  // HR
  if (/candidate|job description|leave balance|onboarding.*hire|performance review|pulse survey|recruiting|hiring/.test(nameText)) return 'HR';
  // Finance
  if (/invoice|expense|payment|budget|revenue|billing|financial|finance|accounting|reconcil|fiscal/.test(nameText)) return 'Finance';
  // Sales
  if (/lead\b|deal stage|churn risk|proposal|win.loss|quote follow|territory|sales|crm|lead concierge|outbound.*intelligence/.test(nameText)) return 'Sales';
  // Marketing
  if (/a.b test|brand mention|utm|influencer|campaign|marketing|audience sync|ad\b.*optim/.test(nameText)) return 'Marketing';
  // Support (tight matching — only when clearly about customer support)
  if (/support intelligence|support escalat|customer feedback|helpdesk|faq|knowledge base.*review|sla\b.*breach/.test(nameText)) return 'Support';
  // Project Management
  if (/standup|deadline|resource alloc|scope creep|sprint|status report|okr|project.*portfolio|planning auto/.test(nameText)) return 'Project Management';
  // Content
  if (/blog|seo|content|social media|press release|changelog|grammar|editorial|cms|wordpress|ghost|video.*knowledge|documentation pub|calendar manager/.test(nameText)) return 'Content';
  // Research
  if (/competitor|intelligence.*aggregat|product.*signal|analytics.*brief|price monitor|industry/.test(nameText)) return 'Research';
  // Email (only truly email-centric templates)
  if (/inbox|newsletter|unsubscrib|deliverability|transactional.*email|email.*monitor|email.*template/.test(nameText)) return 'Email';
  // Productivity
  if (/daily plan|weekly.*review|weekly.*planning|meeting|bookmark|habit|pomodoro|reading|planner|capture bot|time tracking|task sync|decision log/.test(nameText)) return 'Productivity';

  // --- Fallback: check the PRIMARY service (first in the flow) ---
  const firstService = (titleText.split(/\s*→\s*/)[0] || '').trim();
  if (/github|jira|linear|circleci|buildkite|vercel|figma/.test(firstService)) return 'Development';
  if (/datadog|pagerduty|sentry|aws|cloudwatch/.test(firstService)) return 'DevOps';
  if (/stripe|quickbooks|plaid/.test(firstService)) return 'Finance';
  if (/shopify|woocommerce/.test(firstService)) return 'Sales';
  if (/zendesk|intercom/.test(firstService)) return 'Support';
  if (/hubspot|salesforce|pipedrive/.test(firstService)) return 'Sales';
  if (/wordpress|ghost|buffer|contentful/.test(firstService)) return 'Content';
  if (/greenhouse/.test(firstService)) return 'HR';
  if (/notion/.test(firstService)) return 'Productivity';
  if (/gmail/.test(firstService)) return 'Email';
  if (/slack/.test(firstService)) return 'Productivity';
  if (/supabase|postgres|firebase/.test(firstService)) return 'Development';
  if (/calendly/.test(firstService)) return 'Productivity';
  if (/clerk|okta/.test(firstService)) return 'Development';
  if (/mixpanel|amplitude|segment/.test(firstService)) return 'Research';
  if (/clickup|asana/.test(firstService)) return 'Project Management';
  if (/docusign/.test(firstService)) return 'Legal';
  if (/twilio/.test(firstService)) return 'Marketing';

  // --- Last resort: check description for strong signals ---
  if (/monitor.*subscription|billing.*manage|revenue.*track/.test(descText)) return 'Finance';
  if (/monitor.*deploy|health.*check|uptime/.test(descText)) return 'DevOps';
  if (/pr.*review|code.*quality|merge.*request/.test(descText)) return 'Development';

  return 'Productivity';
}

// ============================================================================
// Connector Catalog
// ============================================================================

const CONNECTOR_CATALOG = [
  {
    name: 'google_workspace',
    label: 'Google Workspace',
    category: 'productivity',
    auth_type: 'oauth2',
    services: ['Gmail', 'Google Sheets', 'Google Calendar', 'Google Drive', 'Google Workspace'],
    credential_hint: 'OAuth2 via Google Cloud Console. Enable Gmail API, Sheets API, etc.',
    api_base: 'https://www.googleapis.com',
  },
  {
    name: 'slack',
    label: 'Slack',
    category: 'messaging',
    auth_type: 'bot_token',
    services: ['Slack'],
    credential_hint: 'Bot User OAuth Token from Slack App → OAuth & Permissions',
    api_base: 'https://slack.com/api',
  },
  {
    name: 'github',
    label: 'GitHub',
    category: 'development',
    auth_type: 'pat',
    services: ['GitHub'],
    credential_hint: 'Personal Access Token (fine-grained) from GitHub Settings → Developer settings',
    api_base: 'https://api.github.com',
  },
  {
    name: 'notion',
    label: 'Notion',
    category: 'productivity',
    auth_type: 'integration_token',
    services: ['Notion'],
    credential_hint: 'Internal Integration Token from notion.so/my-integrations',
    api_base: 'https://api.notion.com/v1',
  },
  {
    name: 'jira',
    label: 'Jira',
    category: 'project_management',
    auth_type: 'api_token',
    services: ['Jira'],
    credential_hint: 'API Token from id.atlassian.com/manage-profile/security/api-tokens',
    api_base: 'https://{domain}.atlassian.net/rest/api/3',
  },
  {
    name: 'stripe',
    label: 'Stripe',
    category: 'finance',
    auth_type: 'api_key',
    services: ['Stripe'],
    credential_hint: 'Secret Key from Stripe Dashboard → Developers → API keys',
    api_base: 'https://api.stripe.com/v1',
  },
  {
    name: 'airtable',
    label: 'Airtable',
    category: 'productivity',
    auth_type: 'pat',
    services: ['Airtable'],
    credential_hint: 'Personal Access Token from airtable.com/create/tokens',
    api_base: 'https://api.airtable.com/v0',
  },
  {
    name: 'linear',
    label: 'Linear',
    category: 'development',
    auth_type: 'api_key',
    services: ['Linear'],
    credential_hint: 'API Key from Linear Settings → API → Personal API keys',
    api_base: 'https://api.linear.app/graphql',
  },
  {
    name: 'shopify',
    label: 'Shopify',
    category: 'ecommerce',
    auth_type: 'admin_api_token',
    services: ['Shopify'],
    credential_hint: 'Admin API access token from Shopify Admin → Apps → Develop apps',
    api_base: 'https://{store}.myshopify.com/admin/api/2024-01',
  },
  {
    name: 'zendesk',
    label: 'Zendesk',
    category: 'support',
    auth_type: 'api_token',
    services: ['Zendesk'],
    credential_hint: 'API Token from Zendesk Admin → Channels → API',
    api_base: 'https://{subdomain}.zendesk.com/api/v2',
  },
  {
    name: 'hubspot',
    label: 'HubSpot',
    category: 'crm',
    auth_type: 'api_key',
    services: ['HubSpot'],
    credential_hint: 'Private App access token from HubSpot Settings → Integrations → Private Apps',
    api_base: 'https://api.hubapi.com',
  },
  {
    name: 'salesforce',
    label: 'Salesforce',
    category: 'crm',
    auth_type: 'oauth2',
    services: ['Salesforce'],
    credential_hint: 'Connected App OAuth2 credentials from Salesforce Setup → App Manager',
    api_base: 'https://{instance}.salesforce.com/services/data/v59.0',
  },
  {
    name: 'clickup',
    label: 'ClickUp',
    category: 'project_management',
    auth_type: 'api_key',
    services: ['ClickUp'],
    credential_hint: 'Personal API Token from ClickUp Settings → Apps',
    api_base: 'https://api.clickup.com/api/v2',
  },
  {
    name: 'asana',
    label: 'Asana',
    category: 'project_management',
    auth_type: 'pat',
    services: ['Asana'],
    credential_hint: 'Personal Access Token from Asana Developer Console',
    api_base: 'https://app.asana.com/api/1.0',
  },
  {
    name: 'twilio',
    label: 'Twilio',
    category: 'messaging',
    auth_type: 'api_key',
    services: ['Twilio', 'Twilio SMS'],
    credential_hint: 'Account SID + Auth Token from Twilio Console',
    api_base: 'https://api.twilio.com/2010-04-01',
  },
  {
    name: 'sendgrid',
    label: 'SendGrid',
    category: 'email',
    auth_type: 'api_key',
    services: ['SendGrid'],
    credential_hint: 'API Key from SendGrid Settings → API Keys',
    api_base: 'https://api.sendgrid.com/v3',
  },
  {
    name: 'datadog',
    label: 'Datadog',
    category: 'monitoring',
    auth_type: 'api_key',
    services: ['Datadog'],
    credential_hint: 'API Key + Application Key from Datadog Organization Settings',
    api_base: 'https://api.datadoghq.com/api/v1',
  },
  {
    name: 'pagerduty',
    label: 'PagerDuty',
    category: 'monitoring',
    auth_type: 'api_key',
    services: ['PagerDuty'],
    credential_hint: 'API Key from PagerDuty → Integrations → API Access Keys',
    api_base: 'https://api.pagerduty.com',
  },
  {
    name: 'sentry',
    label: 'Sentry',
    category: 'monitoring',
    auth_type: 'api_key',
    services: ['Sentry'],
    credential_hint: 'Auth Token from Sentry Settings → Auth Tokens',
    api_base: 'https://sentry.io/api/0',
  },
  {
    name: 'vercel',
    label: 'Vercel',
    category: 'deployment',
    auth_type: 'api_token',
    services: ['Vercel'],
    credential_hint: 'Access Token from Vercel Settings → Tokens',
    api_base: 'https://api.vercel.com',
  },
  {
    name: 'aws',
    label: 'AWS',
    category: 'cloud',
    auth_type: 'access_key',
    services: ['AWS', 'AWS CloudWatch', 'AWS S3', 'AWS SES'],
    credential_hint: 'IAM Access Key ID + Secret Access Key with appropriate service permissions',
    api_base: 'https://{service}.{region}.amazonaws.com',
  },
  {
    name: 'confluence',
    label: 'Confluence',
    category: 'documentation',
    auth_type: 'api_token',
    services: ['Confluence'],
    credential_hint: 'API Token from id.atlassian.com (same as Jira tokens)',
    api_base: 'https://{domain}.atlassian.net/wiki/rest/api',
  },
  {
    name: 'intercom',
    label: 'Intercom',
    category: 'support',
    auth_type: 'api_key',
    services: ['Intercom'],
    credential_hint: 'Access Token from Intercom Developer Hub → Your Apps',
    api_base: 'https://api.intercom.io',
  },
  {
    name: 'calendly',
    label: 'Calendly',
    category: 'scheduling',
    auth_type: 'api_key',
    services: ['Calendly'],
    credential_hint: 'Personal Access Token from Calendly Integrations → API',
    api_base: 'https://api.calendly.com',
  },
  {
    name: 'quickbooks',
    label: 'QuickBooks',
    category: 'finance',
    auth_type: 'oauth2',
    services: ['QuickBooks'],
    credential_hint: 'OAuth2 via Intuit Developer Portal — requires app registration',
    api_base: 'https://quickbooks.api.intuit.com/v3',
  },
  {
    name: 'mixpanel',
    label: 'Mixpanel',
    category: 'analytics',
    auth_type: 'api_key',
    services: ['Mixpanel'],
    credential_hint: 'Service Account credentials from Mixpanel Project Settings',
    api_base: 'https://mixpanel.com/api/2.0',
  },
  {
    name: 'wordpress',
    label: 'WordPress',
    category: 'content',
    auth_type: 'api_key',
    services: ['WordPress', 'Ghost'],
    credential_hint: 'Application Password from WP Admin → Users → Profile, or Ghost Admin API key',
    api_base: 'https://{site}/wp-json/wp/v2',
  },
  {
    name: 'discord',
    label: 'Discord',
    category: 'messaging',
    auth_type: 'bot_token',
    services: ['Discord'],
    credential_hint: 'Bot Token from Discord Developer Portal → Applications → Bot',
    api_base: 'https://discord.com/api/v10',
  },
  {
    name: 'supabase',
    label: 'Supabase',
    category: 'database',
    auth_type: 'service_role_key',
    services: ['Supabase'],
    credential_hint: 'Service Role Key from Supabase Dashboard → Settings → API',
    api_base: 'https://{project}.supabase.co/rest/v1',
  },
  {
    name: 'clerk',
    label: 'Clerk',
    category: 'auth',
    auth_type: 'secret_key',
    services: ['Clerk'],
    credential_hint: 'Secret Key from Clerk Dashboard → API Keys',
    api_base: 'https://api.clerk.com/v1',
  },
  {
    name: 'circleci',
    label: 'CircleCI',
    category: 'ci_cd',
    auth_type: 'api_token',
    services: ['CircleCI'],
    credential_hint: 'Personal API Token from CircleCI User Settings → Personal API Tokens',
    api_base: 'https://circleci.com/api/v2',
  },
  {
    name: 'buildkite',
    label: 'Buildkite',
    category: 'ci_cd',
    auth_type: 'api_token',
    services: ['Buildkite'],
    credential_hint: 'API Access Token from Buildkite Personal Settings → API Access Tokens',
    api_base: 'https://api.buildkite.com/v2',
  },
  {
    name: 'greenhouse',
    label: 'Greenhouse',
    category: 'hr',
    auth_type: 'api_key',
    services: ['Greenhouse'],
    credential_hint: 'API Key from Greenhouse → Configure → Dev Center → API Credential Management',
    api_base: 'https://harvest.greenhouse.io/v1',
  },
  {
    name: 'docusign',
    label: 'DocuSign',
    category: 'legal',
    auth_type: 'oauth2',
    services: ['DocuSign'],
    credential_hint: 'OAuth2 Integration Key from DocuSign Admin → Integrations → API',
    api_base: 'https://www.docusign.net/restapi/v2.1',
  },
  {
    name: 'pipedrive',
    label: 'Pipedrive',
    category: 'crm',
    auth_type: 'api_token',
    services: ['Pipedrive'],
    credential_hint: 'Personal API Token from Pipedrive Settings → Personal preferences → API',
    api_base: 'https://api.pipedrive.com/v1',
  },
  {
    name: 'buffer',
    label: 'Buffer',
    category: 'social',
    auth_type: 'api_key',
    services: ['Buffer'],
    credential_hint: 'Access Token from Buffer Developer Portal',
    api_base: 'https://api.bufferapp.com/1',
  },
  {
    name: 'google_sheets',
    label: 'Google Sheets',
    category: 'productivity',
    auth_type: 'oauth2',
    services: ['Google Sheets'],
    credential_hint: 'Uses Google Workspace OAuth2 — enable Sheets API in Cloud Console',
    api_base: 'https://sheets.googleapis.com/v4',
  },
  {
    name: 'twitter',
    label: 'Twitter/X',
    category: 'social',
    auth_type: 'api_key',
    services: ['Twitter', 'Twitter/X', 'X'],
    credential_hint: 'Bearer Token from Twitter Developer Portal → Projects & Apps',
    api_base: 'https://api.twitter.com/2',
  },
  {
    name: 'shipstation',
    label: 'ShipStation',
    category: 'ecommerce',
    auth_type: 'api_key',
    services: ['ShipStation'],
    credential_hint: 'API Key + Secret from ShipStation → Settings → API Settings',
    api_base: 'https://ssapi.shipstation.com',
  },
  {
    name: 'snyk',
    label: 'Snyk',
    category: 'security',
    auth_type: 'api_token',
    services: ['Snyk', 'Dependabot'],
    credential_hint: 'API Token from Snyk Account → Settings → Auth Token',
    api_base: 'https://api.snyk.io/v1',
  },
];

/** Given a connector service name from list.md, find the matching catalog entry */
function matchConnectorByService(serviceName) {
  const normalized = serviceName.replace(/\s*\([^)]+\)\s*$/, '').trim(); // strip "(Bot Token)" etc.
  for (const conn of CONNECTOR_CATALOG) {
    for (const svc of conn.services) {
      if (svc.toLowerCase() === normalized.toLowerCase()) return conn;
    }
  }
  return null;
}

/** Parse the **Connectors**: line and resolve to catalog entries */
function resolveConnectors(connectorsStr) {
  if (!connectorsStr) return [];
  const parts = connectorsStr.split(',').map(s => s.trim()).filter(Boolean);
  const resolved = [];
  const seen = new Set();
  for (const part of parts) {
    const conn = matchConnectorByService(part);
    if (conn && !seen.has(conn.name)) {
      seen.add(conn.name);
      resolved.push({ ...conn, originalLabel: part });
    }
  }
  return resolved;
}

// ============================================================================
// Available Tools
// ============================================================================

const AVAILABLE_TOOLS = [
  { name: 'gmail_read', category: 'email', description: 'Read Gmail messages by ID or thread. Returns full message content, headers, labels, and attachments metadata. Requires google_workspace connector.' },
  { name: 'gmail_send', category: 'email', description: 'Send or draft Gmail messages. Supports plain text and HTML bodies, recipients, CC/BCC, attachments, and reply threading. Requires google_workspace connector.' },
  { name: 'gmail_search', category: 'email', description: 'Search Gmail with query syntax (from:, subject:, label:, is:unread, etc). Returns matching message IDs with basic metadata. Requires google_workspace connector.' },
  { name: 'gmail_mark_read', category: 'email', description: 'Modify Gmail message labels — add/remove labels, mark as read/unread, move to trash, archive. Requires google_workspace connector.' },
  { name: 'http_request', category: 'integration', description: 'Make HTTP requests to any API endpoint. Supports GET, POST, PUT, PATCH, DELETE with custom headers, body, and authentication. Used for ALL external service integrations (Slack, GitHub, Jira, Stripe, Notion, etc.) with credentials injected from the connector.' },
  { name: 'file_read', category: 'local_storage', description: 'Read LOCAL files only (text, JSON, CSV, YAML). Returns file contents as string. This is LOCAL filesystem — NOT for cloud storage (Google Sheets, Airtable, S3, etc.).' },
  { name: 'file_write', category: 'local_storage', description: 'Write or append to LOCAL files only. Supports text, JSON, and binary. This is LOCAL filesystem — NOT for cloud storage. Use http_request + connector for cloud services.' },
];

// ============================================================================
// Design Prompt Builder (v2 — with connector catalog + service flow)
// ============================================================================

const DESIGN_OUTPUT_SCHEMA = `## Required Output Format

You MUST output your result as a single JSON code block. The JSON must conform to this exact schema:

\`\`\`json
{
  "service_flow": ["Service1", "Service2", "Service3"],
  "structured_prompt": {
    "identity": "Who this persona is and its core purpose",
    "instructions": "Step-by-step instructions for the persona",
    "toolGuidance": "How and when to use each tool, with API endpoint examples",
    "examples": "Example interactions or scenarios",
    "errorHandling": "How to handle errors and edge cases",
    "customSections": [
      { "key": "section_key", "label": "Section Label", "content": "Section content" }
    ]
  },
  "suggested_tools": ["tool_name_1", "tool_name_2"],
  "suggested_triggers": [
    {
      "trigger_type": "schedule|polling|webhook|manual",
      "config": { "cron": "*/5 * * * *" },
      "description": "What this trigger does"
    }
  ],
  "full_prompt_markdown": "# Complete System Prompt\\n\\nThe full prompt in markdown...",
  "summary": "One-paragraph summary of this persona design",
  "design_highlights": [
    {
      "category": "Category Name",
      "icon": "emoji",
      "color": "blue",
      "items": ["Key capability 1", "Key capability 2"]
    }
  ],
  "suggested_connectors": [
    {
      "name": "connector_slug",
      "label": "Human Readable Name",
      "auth_type": "oauth2|pat|api_key|bot_token|service_account|api_token",
      "credential_fields": [
        {
          "key": "field_key",
          "label": "Human Label",
          "type": "text|password",
          "placeholder": "example value",
          "helpText": "Where to find this credential",
          "required": true
        }
      ],
      "setup_instructions": "Step-by-step setup guide for this specific service",
      "related_tools": ["http_request"],
      "related_triggers": [0],
      "api_base_url": "https://api.service.com"
    }
  ],
  "suggested_notification_channels": [
    {
      "type": "slack|telegram|email",
      "description": "Channel purpose",
      "required_connector": "connector_name",
      "config_hints": { "channel": "#alerts" }
    }
  ],
  "suggested_event_subscriptions": [
    {
      "event_type": "event_name",
      "description": "When and why to listen for this event"
    }
  ]
}
\`\`\`

Critical rules:
1. \`suggested_tools\` must only reference tools from the Available Tools list above
2. Each external service MUST have its own NAMED connector (e.g., "slack", "github", "stripe") — NEVER use "http_generic"
3. Each connector MUST include \`credential_fields\` with at least one field showing what the user needs to provide
4. Each connector MUST include \`auth_type\` matching its authentication method
5. Each connector MUST include \`api_base_url\` with the service's API base URL
6. \`setup_instructions\` must be specific to the service (not generic HTTP instructions)
7. \`file_read\`/\`file_write\` are LOCAL filesystem ONLY — for cloud storage (Google Sheets, Airtable, S3, Notion databases), use \`http_request\` with the appropriate connector
8. \`service_flow\` must list the external services in data-pipeline order (matching the template's integration flow)
9. \`full_prompt_markdown\` must be the complete, ready-to-use system prompt in markdown format (>1500 chars)
10. Output ONLY the JSON block — no additional text before or after
11. Do NOT ask clarification questions — produce the best possible design
12. Each section of structured_prompt should be detailed (identity >100 chars, instructions >500 chars, toolGuidance >200 chars, examples >200 chars, errorHandling >200 chars)
13. Include at least 3-4 design_highlights with 3-4 items each
14. The toolGuidance section MUST include specific API endpoints and HTTP methods for each connector service`;

function buildDesignPrompt(template) {
  let prompt = '# Persona Design Analysis\n\n';
  prompt += 'You are an expert AI systems architect designing an intelligent agent persona that replaces multiple rigid automation workflows with a single reasoning-capable agent.\n\n';

  // Target persona info
  prompt += `## Target Persona: ${template.name}\n`;
  prompt += `Full title: ${template.fullTitle}\n`;
  prompt += `Description: ${template.description}\n\n`;

  // Available tools with clear descriptions
  prompt += '## Available Tools\n';
  for (const tool of AVAILABLE_TOOLS) {
    prompt += `- **${tool.name}** (${tool.category}): ${tool.description}\n`;
  }
  prompt += '\n';

  // Tool-Connector Architecture guidance
  prompt += '## Tool-Connector Architecture\n\n';
  prompt += 'The Personas platform uses this integration model:\n';
  prompt += '- **gmail_read/gmail_send/gmail_search/gmail_mark_read**: Native tools that require the `google_workspace` connector for OAuth2 credentials.\n';
  prompt += '- **http_request**: The universal integration tool for ALL external services. For Slack, GitHub, Jira, Stripe, Notion, Airtable, etc., use http_request with credentials injected from the named connector. Each service gets its own connector entry with specific auth type and credential fields.\n';
  prompt += '- **file_read/file_write**: LOCAL filesystem ONLY. Reads/writes files on the agent\'s local disk for state tracking, caches, logs. These are NOT cloud storage. For Google Sheets → use http_request + google_sheets connector. For Airtable → use http_request + airtable connector. For S3 → use http_request + aws connector. For Notion databases → use http_request + notion connector.\n\n';

  // Available connectors from catalog (only those relevant to this template)
  const resolvedConnectors = resolveConnectors(template.connectors);
  prompt += '## Available Connectors for This Template\n';
  prompt += 'These represent credential-backed integrations. Each provides authenticated access to an external service via the http_request tool.\n\n';

  if (resolvedConnectors.length > 0) {
    for (const conn of resolvedConnectors) {
      prompt += `- **${conn.name}** (${conn.category}): ${conn.label} — ${conn.auth_type} authentication.\n`;
      prompt += `  Credential hint: ${conn.credential_hint}\n`;
      prompt += `  API base: ${conn.api_base}\n`;
    }
  } else {
    // Fallback: list all connectors
    for (const conn of CONNECTOR_CATALOG.slice(0, 10)) {
      prompt += `- **${conn.name}** (${conn.category}): ${conn.label} — ${conn.auth_type}. API: ${conn.api_base}\n`;
    }
  }
  prompt += '\n';

  // Template context from list.md
  prompt += '## Template Context from list.md\n';
  if (template.serviceFlow.length > 0) {
    prompt += `Service flow: ${template.serviceFlow.join(' → ')}\n`;
  }
  if (template.connectors) {
    prompt += `External connectors needed: ${template.connectors}\n`;
  }
  if (template.replaces) {
    prompt += `Replaces these workflows: ${template.replaces}\n`;
  }
  if (template.protocols) {
    prompt += `Communication protocols to use: ${template.protocols}\n`;
  }
  if (template.trigger) {
    prompt += `Trigger configuration: ${template.trigger}\n`;
  }
  if (template.tools) {
    prompt += `Required tools: ${template.tools}\n`;
  }
  prompt += '\n';

  // Pipeline-specific context
  if (template.useCases.length > 0) {
    prompt += '## Multi-Agent Pipeline Structure\n';
    prompt += 'This is a pipeline template with multiple coordinated agents:\n\n';
    for (const uc of template.useCases) {
      prompt += `- **${uc.name}** (${uc.role}): ${uc.description}\n`;
    }
    prompt += '\nDesign the orchestrator persona that coordinates these agents. Include the team structure in customSections.\n\n';
  }

  // User instruction
  prompt += '## User Instruction\n';
  prompt += template.description + '\n\n';

  // Output schema
  prompt += DESIGN_OUTPUT_SCHEMA;

  return prompt;
}

// ============================================================================
// Claude CLI Runner
// ============================================================================

function verifyClaudeCli() {
  try {
    return execSync('claude --version', {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function runClaudeCli(promptText, timeoutSecs = 180) {
  const tmpFile = join(ROOT, 'scripts', 'templates', '_tmp_prompt.txt');
  writeFileSync(tmpFile, promptText, 'utf-8');

  try {
    const cmd = `claude -p - --output-format stream-json --verbose --dangerously-skip-permissions --max-turns 1 < "${tmpFile.replace(/\\/g, '/')}"`;
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutSecs * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    return { ok: true, output };
  } catch (err) {
    if (err.killed) {
      return { ok: false, error: `Timed out after ${timeoutSecs}s` };
    }
    if (err.stdout) {
      return { ok: true, output: err.stdout };
    }
    return { ok: false, error: (err.stderr || err.message || String(err)).substring(0, 200) };
  } finally {
    try { writeFileSync(tmpFile, '', 'utf-8'); } catch { /* ignore */ }
  }
}

// ============================================================================
// Result Extractor (mirrors Rust extract_design_result)
// ============================================================================

function extractDesignResult(rawOutput) {
  // Try fenced JSON blocks first
  const fencedRegex = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = fencedRegex.exec(rawOutput)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.structured_prompt) return parsed;
    } catch { /* continue */ }
  }

  // Try to find JSON in stream-json lines
  const lines = rawOutput.split('\n');
  let fullText = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.content && Array.isArray(obj.content)) {
        for (const item of obj.content) {
          if (item.type === 'text' && item.text) {
            fullText += item.text;
          }
        }
      }
      if (obj.result && typeof obj.result === 'string') {
        fullText += obj.result;
      }
    } catch {
      fullText += line;
    }
  }

  // Try fenced blocks from extracted text
  const fencedRegex2 = /```(?:json)?\s*\n([\s\S]*?)```/g;
  while ((match = fencedRegex2.exec(fullText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.structured_prompt) return parsed;
    } catch { /* continue */ }
  }

  // Try bare JSON (find { with "structured_prompt")
  const structuredIdx = fullText.indexOf('"structured_prompt"');
  if (structuredIdx >= 0) {
    let braceIdx = fullText.lastIndexOf('{', structuredIdx);
    if (braceIdx >= 0) {
      let depth = 0;
      for (let i = braceIdx; i < fullText.length; i++) {
        if (fullText[i] === '{') depth++;
        else if (fullText[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(fullText.substring(braceIdx, i + 1));
              if (parsed.structured_prompt) return parsed;
            } catch { /* continue */ }
          }
        }
      }
    }
  }

  return null;
}

// ============================================================================
// Template File Writer
// ============================================================================

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CATEGORY_COLORS = {
  Email: '#3B82F6',
  Development: '#10B981',
  Content: '#F59E0B',
  Research: '#06B6D4',
  'Project Management': '#8B5CF6',
  Finance: '#22C55E',
  DevOps: '#F97316',
  HR: '#EC4899',
  Sales: '#6366F1',
  Support: '#14B8A6',
  Legal: '#EF4444',
  Productivity: '#7C3AED',
  Marketing: '#D946EF',
  Security: '#F43F5E',
  Pipeline: '#0EA5E9',
};

const CATEGORY_ICONS = {
  Email: 'Mail',
  Development: 'Code',
  Content: 'FileText',
  Research: 'Search',
  'Project Management': 'Kanban',
  Finance: 'DollarSign',
  DevOps: 'Server',
  HR: 'Users',
  Sales: 'TrendingUp',
  Support: 'HeadphonesIcon',
  Legal: 'Scale',
  Productivity: 'Zap',
  Marketing: 'Megaphone',
  Security: 'Shield',
  Pipeline: 'GitBranch',
};

function categoryToDir(category) {
  return slugify(category);
}

function writeTemplateFile(template, payload) {
  const slug = slugify(template.name);
  const catDir = categoryToDir(template.category || 'uncategorized');
  const dir = join(ROOT, 'scripts', 'templates', catDir);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${slug}.json`);
  const templateFile = {
    id: slug,
    name: template.name,
    description: template.description,
    icon: CATEGORY_ICONS[template.category] || 'Bot',
    color: CATEGORY_COLORS[template.category] || '#6B7280',
    category: template.category
      ? [template.category.toLowerCase().replace(/\s+/g, '-')]
      : ['general'],
    service_flow: template.serviceFlow || [],
    payload,
  };

  writeFileSync(filePath, JSON.stringify(templateFile, null, 2) + '\n', 'utf-8');
  return filePath;
}

// ============================================================================
// Quality Scoring (v2 — includes connector quality)
// ============================================================================

function scoreDesignResult(result, template) {
  let structural = 0;
  let semantic = 0;

  // Structural scoring (base: 80 points)
  const sp = result.structured_prompt;
  if (sp) structural += 15;
  if (result.suggested_tools?.length > 0) structural += 10;
  if (result.suggested_triggers?.length > 0) structural += 10;
  if (result.full_prompt_markdown?.length > 500) structural += 15;
  if (result.summary?.length > 50) structural += 5;
  if (sp?.identity?.length > 100) structural += 5;
  if (sp?.instructions?.length > 200) structural += 5;
  if (sp?.toolGuidance?.length > 100) structural += 5;
  if (sp?.errorHandling?.length > 100) structural += 5;
  if (result.design_highlights?.length >= 2) structural += 5;

  // Connector quality scoring (20 points)
  if (result.suggested_connectors?.length > 0) {
    let connScore = 0;
    for (const conn of result.suggested_connectors) {
      if (conn.name && conn.name !== 'http_generic') connScore += 3;
      if (conn.credential_fields?.length > 0) connScore += 3;
      if (conn.auth_type) connScore += 2;
      if (conn.setup_instructions?.length > 30) connScore += 1;
      if (conn.api_base_url) connScore += 1;
    }
    structural += Math.min(connScore, 20);
  }

  // Cap at 100
  structural = Math.min(structural, 100);

  // Semantic scoring — tool match + connector match
  const availableToolNames = AVAILABLE_TOOLS.map(t => t.name);
  let toolScore = 0;
  if (result.suggested_tools?.length > 0) {
    const matched = result.suggested_tools.filter(t => availableToolNames.includes(t)).length;
    toolScore = Math.round((matched / result.suggested_tools.length) * 50);
  }

  // Connector semantic: how many expected connectors are present
  let connScore = 0;
  const expectedConnectors = resolveConnectors(template.connectors);
  if (expectedConnectors.length > 0 && result.suggested_connectors?.length > 0) {
    const suggestedNames = new Set(result.suggested_connectors.map(c => c.name));
    const matched = expectedConnectors.filter(c => suggestedNames.has(c.name)).length;
    connScore = Math.round((matched / expectedConnectors.length) * 50);
  } else if (expectedConnectors.length === 0) {
    connScore = 50; // no connectors expected, full score
  }

  semantic = toolScore + connScore;

  return { structural, semantic };
}

// ============================================================================
// CLI Arguments
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: null,
    from: null,
    to: null,
    ids: null,
    category: null,
    skipExisting: false,
    dryRun: false,
    timeout: 180,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit': opts.limit = parseInt(args[++i], 10); break;
      case '--from': opts.from = parseInt(args[++i], 10); break;
      case '--to': opts.to = parseInt(args[++i], 10); break;
      case '--ids': opts.ids = args[++i].split(',').map(n => parseInt(n, 10)); break;
      case '--category': opts.category = args[++i]; break;
      case '--skip-existing': opts.skipExisting = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--timeout': opts.timeout = parseInt(args[++i], 10); break;
      case '--help':
        console.log(`
Batch Template Generator (v2)

Usage:
  node scripts/generate-templates.mjs [options]

Options:
  --limit N          Generate only first N templates
  --from N           Start from template number N (inclusive)
  --to N             End at template number N (inclusive)
  --ids 1,5,9        Generate specific template numbers
  --category Email   Filter by category name
  --skip-existing    Skip templates that already have a JSON file
  --dry-run          Parse and preview without calling Claude CLI
  --timeout N        Timeout per template in seconds (default: 180)
  --help             Show this help
`);
        process.exit(0);
    }
  }
  return opts;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    Personas Template Batch Generator (v2)        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();

  // Parse list.md
  const listPath = join(ROOT, 'list.md');
  if (!existsSync(listPath)) {
    console.error('ERROR: list.md not found at', listPath);
    process.exit(1);
  }

  let templates = parseListMd(listPath);
  console.log(`Parsed ${templates.length} templates from list.md`);

  // Apply filters
  if (opts.ids) {
    templates = templates.filter(t => opts.ids.includes(t.num));
  }
  if (opts.from !== null) {
    templates = templates.filter(t => t.num >= opts.from);
  }
  if (opts.to !== null) {
    templates = templates.filter(t => t.num <= opts.to);
  }
  if (opts.category) {
    templates = templates.filter(t => t.category?.toLowerCase() === opts.category.toLowerCase());
  }
  if (opts.limit !== null) {
    templates = templates.slice(0, opts.limit);
  }
  if (opts.skipExisting) {
    templates = templates.filter(t => {
      const slug = slugify(t.name);
      const catDir = categoryToDir(t.category || 'uncategorized');
      const filePath = join(ROOT, 'scripts', 'templates', catDir, `${slug}.json`);
      return !existsSync(filePath);
    });
  }

  console.log(`Will generate ${templates.length} templates${opts.dryRun ? ' (DRY RUN)' : ''}`);

  // Category breakdown
  const cats = {};
  for (const t of templates) {
    cats[t.category || 'Unknown'] = (cats[t.category || 'Unknown'] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(cats).sort()) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log();

  if (opts.dryRun) {
    console.log('=== DRY RUN — Template Preview ===\n');
    for (const t of templates) {
      const conns = resolveConnectors(t.connectors);
      console.log(`  #${t.num} ${t.name}`);
      console.log(`    Title: ${t.fullTitle}`);
      console.log(`    ${t.description.substring(0, 100)}...`);
      console.log(`    Flow: ${t.serviceFlow.length > 0 ? t.serviceFlow.join(' → ') : '(none)'}`);
      console.log(`    Tools: ${t.tools || 'none'} | Trigger: ${t.trigger || 'none'}`);
      console.log(`    Connectors: ${conns.map(c => `${c.name}(${c.auth_type})`).join(', ') || 'none'}`);
      console.log(`    Category: ${t.category || 'none'}`);
      if (t.useCases.length > 0) {
        console.log(`    Pipeline: ${t.useCases.map(uc => `${uc.name}(${uc.role})`).join(', ')}`);
      }
      console.log();
    }
    return;
  }

  // Verify Claude CLI
  const cliVersion = verifyClaudeCli();
  if (!cliVersion) {
    console.error('ERROR: Claude CLI not found.');
    process.exit(1);
  }
  console.log(`Claude CLI: ${cliVersion}\n`);

  // Write batch log
  const logPath = join(ROOT, 'scripts', 'templates', '_batch_log.txt');

  // Process templates
  const results = { passed: 0, failed: 0, errored: 0 };
  const startTime = Date.now();

  const logLines = [];
  const log = (msg) => { console.log(msg); logLines.push(msg); };

  log('╔══════════════════════════════════════════════════╗');
  log('║    Personas Template Batch Generator (v2)        ║');
  log('╚══════════════════════════════════════════════════╝');
  log('');
  log(`Parsed ${templates.length + (opts.skipExisting ? ' (after skip-existing filter)' : '')} templates`);
  log(`Claude CLI: ${cliVersion}`);
  log('');

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const progress = `[${i + 1}/${templates.length}]`;

    log(`${progress} Generating: ${template.name}...`);

    // Build prompt
    const prompt = buildDesignPrompt(template);

    // Run Claude CLI
    const cliStart = Date.now();
    const cliResult = runClaudeCli(prompt, opts.timeout);
    const elapsed = ((Date.now() - cliStart) / 1000).toFixed(1);

    if (!cliResult.ok) {
      log(`${progress} ${template.name}: ERROR (${elapsed}s) — ${cliResult.error}`);
      results.errored++;
      writeFileSync(logPath, logLines.join('\n'), 'utf-8');
      continue;
    }

    // Extract design result
    const designResult = extractDesignResult(cliResult.output);
    if (!designResult) {
      log(`${progress} ${template.name}: FAILED (${elapsed}s) — Could not extract design JSON`);
      const debugDir = join(ROOT, 'scripts', 'templates', '_debug');
      mkdirSync(debugDir, { recursive: true });
      writeFileSync(join(debugDir, `${slugify(template.name)}.raw.txt`), cliResult.output, 'utf-8');
      results.failed++;
      writeFileSync(logPath, logLines.join('\n'), 'utf-8');
      continue;
    }

    // Inject service_flow if not present
    if (!designResult.service_flow && template.serviceFlow.length > 0) {
      designResult.service_flow = template.serviceFlow;
    }

    // Score the result
    const scores = scoreDesignResult(designResult, template);

    // Write template file
    const filePath = writeTemplateFile(template, designResult);

    const status = scores.structural >= 50 ? 'PASSED' : 'FAILED';
    if (status === 'PASSED') results.passed++;
    else results.failed++;

    // Count named connectors (not http_generic)
    const namedConns = (designResult.suggested_connectors || []).filter(c => c.name !== 'http_generic').length;
    const hasCredFields = (designResult.suggested_connectors || []).some(c => c.credential_fields?.length > 0);

    log(`${progress} ${template.name}: ${status} (${elapsed}s) — structural: ${scores.structural}, semantic: ${scores.semantic}, connectors: ${namedConns}${hasCredFields ? ' (with creds)' : ''}`);
    log(`         → ${filePath.replace(ROOT, '.')}`);

    // ETA
    if (i < templates.length - 1) {
      const avgMs = (Date.now() - startTime) / (i + 1);
      const remaining = Math.ceil((templates.length - i - 1) * avgMs / 1000);
      if (remaining > 3600) {
        log(`         ETA: ~${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`);
      } else if (remaining > 60) {
        log(`         ETA: ~${Math.floor(remaining / 60)}m ${remaining % 60}s`);
      }
    }

    writeFileSync(logPath, logLines.join('\n'), 'utf-8');
  }

  // Summary
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('');
  log('╔══════════════════════════════════════════════════╗');
  log('║                    RESULTS                       ║');
  log('╠══════════════════════════════════════════════════╣');
  log(`║  Total:    ${templates.length.toString().padStart(4)}                                  ║`);
  log(`║  Passed:   ${results.passed.toString().padStart(4)}                                  ║`);
  log(`║  Failed:   ${results.failed.toString().padStart(4)}                                  ║`);
  log(`║  Errors:   ${results.errored.toString().padStart(4)}                                  ║`);
  log(`║  Duration: ${totalElapsed.padStart(8)}s                             ║`);
  log('╚══════════════════════════════════════════════════╝');

  if (results.failed > 0 || results.errored > 0) {
    log('\nTip: Re-run with --skip-existing to retry only failed templates');
  }

  writeFileSync(logPath, logLines.join('\n'), 'utf-8');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
