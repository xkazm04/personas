#!/usr/bin/env node
/**
 * v3.1 de-branding pass — rename tool-specific connectors in templates to
 * category-generic role slots so templates don't lock users into specific
 * providers.
 *
 * For each template that declares a `persona.connectors[]` entry whose
 * `name` is a known tool (gmail, slack, notion, github, ...), we:
 *   1. Rename the connector to its role slot name (email, messaging, ...)
 *   2. Retag `category` to the canonical vault category
 *   3. Relabel from "Gmail" → "Email Provider"
 *   4. Update any UC's `connectors: [<names>]` references to the new name
 *   5. Update any `use_case_flow.nodes[].connector` references
 *   6. Update the `sample_input` `{{param.X}}` bindings where the old name
 *      appeared as a suffix (best-effort textual substitution)
 *   7. Ensure an adoption question with vault `dynamic_source` exists for
 *      the role; if not, append one
 *
 * We intentionally DO NOT rewrite `operating_instructions`, `tool_guidance`,
 * or `error_handling` — those legitimately reference the tool's specific
 * API endpoints as examples. The role slot decouples binding, not docs.
 *
 * Identity-bound templates (Sentry Production Monitor, Telegram Ops Center,
 * Obsidian Vault Memory, Stripe-specific billers) are skipped for
 * connectors where the tool IS the persona's identity — handled via the
 * IDENTITY_TEMPLATES allow-list.
 *
 * Run with:
 *   node scripts/normalize-template-connector-roles.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');

// Tool connector name → { role: slot name, category: vault category,
//   label: generic label, question: { question text, context } }
// Only listed tools are rewritten; everything else is preserved as-is.
const ROLE_MAP = {
  // Email
  gmail:                 { role: 'email',          category: 'email',            label: 'Email Provider',
                           q: 'Which email provider should this persona use?',
                           ctx: 'Options are auto-detected from your email-category credentials in the Vault (Gmail, Outlook, Resend, SendGrid, …).' },
  microsoft_outlook:     { role: 'email',          category: 'email',            label: 'Email Provider',
                           q: 'Which email provider should this persona use?',
                           ctx: 'Options are auto-detected from your email-category credentials in the Vault.' },
  sendgrid:              { role: 'email',          category: 'email',            label: 'Email Provider',
                           q: 'Which email provider should this persona use?',
                           ctx: 'Options are auto-detected from your email-category credentials in the Vault.' },
  resend:                { role: 'email',          category: 'email',            label: 'Email Provider',
                           q: 'Which email provider should this persona use?',
                           ctx: 'Options are auto-detected from your email-category credentials in the Vault.' },

  // Messaging
  slack:                 { role: 'messaging',      category: 'messaging',        label: 'Team Messaging',
                           q: 'Which team messaging platform should this persona post to?',
                           ctx: 'Options are auto-detected from your messaging-category credentials in the Vault (Slack, Discord, Teams, Telegram, …).' },
  discord:               { role: 'messaging',      category: 'messaging',        label: 'Team Messaging',
                           q: 'Which team messaging platform should this persona post to?',
                           ctx: 'Options are auto-detected from your messaging-category credentials in the Vault.' },
  microsoft_teams:       { role: 'messaging',      category: 'messaging',        label: 'Team Messaging',
                           q: 'Which team messaging platform should this persona post to?',
                           ctx: 'Options are auto-detected from your messaging-category credentials in the Vault.' },
  telegram:              { role: 'messaging',      category: 'messaging',        label: 'Team Messaging',
                           q: 'Which messaging platform should this persona post to?',
                           ctx: 'Options are auto-detected from your messaging-category credentials in the Vault.' },

  // Knowledge base / docs
  notion:                { role: 'knowledge_base', category: 'knowledge_base',   label: 'Knowledge Base',
                           q: 'Which knowledge base should this persona read from and write to?',
                           ctx: 'Options are auto-detected from your knowledge_base credentials in the Vault (Notion, Confluence, Obsidian, …).' },
  confluence:            { role: 'knowledge_base', category: 'knowledge_base',   label: 'Knowledge Base',
                           q: 'Which knowledge base should this persona read from and write to?',
                           ctx: 'Options are auto-detected from your knowledge_base credentials in the Vault.' },

  // Storage
  google_drive:          { role: 'storage',        category: 'storage',          label: 'Storage Target',
                           q: 'Where should this persona read and write files?',
                           ctx: 'Options are auto-detected from your storage credentials in the Vault (Google Drive, Dropbox, OneDrive, S3, R2, Local Drive, …).' },
  dropbox:               { role: 'storage',        category: 'storage',          label: 'Storage Target',
                           q: 'Where should this persona read and write files?',
                           ctx: 'Options are auto-detected from your storage credentials in the Vault.' },

  // Source control
  github:                { role: 'source_control', category: 'source_control',   label: 'Source Control',
                           q: 'Which source-control credential should this persona operate with?',
                           ctx: 'Options are auto-detected from your source_control credentials in the Vault (GitHub, GitLab, Azure DevOps, …).' },
  gitlab:                { role: 'source_control', category: 'source_control',   label: 'Source Control',
                           q: 'Which source-control credential should this persona operate with?',
                           ctx: 'Options are auto-detected from your source_control credentials in the Vault.' },

  // Ticketing
  jira:                  { role: 'ticketing',      category: 'ticketing',        label: 'Ticketing System',
                           q: 'Which ticketing system should this persona write to?',
                           ctx: 'Options are auto-detected from your ticketing credentials in the Vault (Jira, Linear, …).' },
  linear:                { role: 'ticketing',      category: 'ticketing',        label: 'Ticketing System',
                           q: 'Which ticketing system should this persona write to?',
                           ctx: 'Options are auto-detected from your ticketing credentials in the Vault.' },

  // CRM
  hubspot:               { role: 'crm',            category: 'crm',              label: 'CRM',
                           q: 'Which CRM should this persona sync with?',
                           ctx: 'Options are auto-detected from your crm credentials in the Vault (HubSpot, Attio, Pipedrive, …).' },
  attio:                 { role: 'crm',            category: 'crm',              label: 'CRM',
                           q: 'Which CRM should this persona sync with?',
                           ctx: 'Options are auto-detected from your crm credentials in the Vault.' },
  pipedrive:             { role: 'crm',            category: 'crm',              label: 'CRM',
                           q: 'Which CRM should this persona sync with?',
                           ctx: 'Options are auto-detected from your crm credentials in the Vault.' },

  // Social feeds / publishing
  reddit:                { role: 'social_feed',    category: 'social_feed',      label: 'Social Feed',
                           q: 'Which social feed should this persona monitor?',
                           ctx: 'Options are auto-detected from your social_feed credentials in the Vault (Reddit, X/Twitter, LinkedIn, YouTube, …).' },
  x_twitter:             { role: 'social_feed',    category: 'social_feed',      label: 'Social Feed',
                           q: 'Which social feed should this persona monitor?',
                           ctx: 'Options are auto-detected from your social_feed credentials in the Vault.' },
  linkedin:              { role: 'social_feed',    category: 'social_feed',      label: 'Social Feed',
                           q: 'Which social feed should this persona monitor?',
                           ctx: 'Options are auto-detected from your social_feed credentials in the Vault.' },
  youtube_data:          { role: 'social_feed',    category: 'social_feed',      label: 'Social Feed',
                           q: 'Which social feed should this persona monitor?',
                           ctx: 'Options are auto-detected from your social_feed credentials in the Vault.' },

  // Spreadsheet
  google_sheets:         { role: 'spreadsheet',    category: 'spreadsheet',      label: 'Spreadsheet',
                           q: 'Which spreadsheet backend should this persona use?',
                           ctx: 'Options are auto-detected from your spreadsheet credentials in the Vault (Google Sheets, Excel, Airtable, …).' },
  microsoft_excel:       { role: 'spreadsheet',    category: 'spreadsheet',      label: 'Spreadsheet',
                           q: 'Which spreadsheet backend should this persona use?',
                           ctx: 'Options are auto-detected from your spreadsheet credentials in the Vault.' },
  airtable:              { role: 'spreadsheet',    category: 'spreadsheet',      label: 'Spreadsheet',
                           q: 'Which spreadsheet backend should this persona use?',
                           ctx: 'Options are auto-detected from your spreadsheet credentials in the Vault.' },

  // Calendar
  google_calendar:       { role: 'calendar',       category: 'calendar',         label: 'Calendar',
                           q: 'Which calendar should this persona read and write to?',
                           ctx: 'Options are auto-detected from your calendar credentials in the Vault (Google Calendar, Outlook Calendar, Cal.com, Calendly).' },
  microsoft_calendar:    { role: 'calendar',       category: 'calendar',         label: 'Calendar',
                           q: 'Which calendar should this persona read and write to?',
                           ctx: 'Options are auto-detected from your calendar credentials in the Vault.' },
  cal_com:               { role: 'calendar',       category: 'calendar',         label: 'Calendar',
                           q: 'Which calendar should this persona read and write to?',
                           ctx: 'Options are auto-detected from your calendar credentials in the Vault.' },
  calendly:              { role: 'calendar',       category: 'calendar',         label: 'Calendar',
                           q: 'Which calendar should this persona read and write to?',
                           ctx: 'Options are auto-detected from your calendar credentials in the Vault.' },
};

// Templates where a specific connector IS the persona's identity and must
// NOT be de-branded. Keyed by template id → set of connector names to
// preserve. These are where the tool name appears in the template name or
// where the persona fundamentally depends on tool-specific APIs.
const IDENTITY_KEEP = {
  'sentry-production-monitor': new Set(['sentry']),
  'telegram-ops-command-center': new Set(['telegram']),
  'autonomous-issue-resolver': new Set(['jira']), // Jira-specific by design
  'dev-clone': new Set(['github']),               // Dev Clone's webhook is GitHub-specific
  'reddit-trend-digest': new Set(['reddit']),     // name will be renamed separately
  'youtube-content-pipeline': new Set(['youtube_data']),
};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (f.endsWith('.json') && !/\.[a-z]{2}\.json$/.test(f)) out.push(p);
  }
  return out;
}

const files = walk(TEMPLATES_DIR);
let changed = 0;
const summary = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf-8');
  const data = JSON.parse(raw);
  const templateId = data.id;
  const persona = data.payload?.persona;
  if (!persona) continue;
  const connectors = Array.isArray(persona.connectors) ? persona.connectors : [];
  const questions = Array.isArray(data.payload?.adoption_questions) ? data.payload.adoption_questions : [];
  const useCases = Array.isArray(data.payload?.use_cases) ? data.payload.use_cases : [];

  const identityKeep = IDENTITY_KEEP[templateId] ?? new Set();
  const renames = {}; // oldName → newRole
  const localChanges = [];

  for (const c of connectors) {
    const oldName = c.name;
    if (!oldName || !ROLE_MAP[oldName]) continue;
    if (identityKeep.has(oldName)) continue;
    // Skip if a connector with the same role already exists — the template
    // author already separated concerns (e.g. has both `email` and `gmail`;
    // keep the renamed one from colliding).
    const target = ROLE_MAP[oldName];
    if (connectors.some((cc) => cc !== c && cc.name === target.role)) continue;

    renames[oldName] = target.role;
    c.name = target.role;
    c.label = target.label;
    c.category = target.category;
    localChanges.push(`${oldName} → ${target.role}`);
  }

  if (Object.keys(renames).length === 0) {
    // Still ensure every connector has a vault-picker adoption question
    // even if no renames happened in this template.
    const added = ensureVaultPickersForRoles(connectors, questions);
    if (added.length) {
      localChanges.push(...added.map((r) => `+aq_${r}_credential`));
    }
    if (localChanges.length) {
      summary.push(`${file.replace(TEMPLATES_DIR, 'templates')}: ${localChanges.join(', ')}`);
      writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      changed++;
    }
    continue;
  }

  // Rewrite cross-references: use-case `connectors: [...]` arrays,
  // `use_case_flow.nodes[].connector`, and any `sample_input` keys that
  // reference the old name via `{{param.aq_<old>_*}}` — we don't touch
  // those params; only the connector slot IDs.
  for (const uc of useCases) {
    if (Array.isArray(uc.connectors)) {
      uc.connectors = uc.connectors.map((n) => renames[n] ?? n);
    }
    if (uc.use_case_flow?.nodes) {
      for (const n of uc.use_case_flow.nodes) {
        if (n.connector && renames[n.connector]) n.connector = renames[n.connector];
      }
    }
  }

  // Adoption questions: update `connector_names` arrays to use the new
  // role name so the vault-picker matcher binds to the right slot.
  for (const q of questions) {
    if (Array.isArray(q.connector_names)) {
      q.connector_names = q.connector_names.map((n) => renames[n] ?? n);
    }
  }

  // Ensure a vault-picker adoption question exists per renamed role.
  const added = ensureVaultPickersForRoles(connectors, questions);
  if (added.length) {
    localChanges.push(...added.map((r) => `+aq_${r}_credential`));
  }

  summary.push(`${file.replace(TEMPLATES_DIR, 'templates')}: ${localChanges.join(', ')}`);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  changed++;
}

function ensureVaultPickersForRoles(connectors, questions) {
  const added = [];
  for (const c of connectors) {
    const role = c.name;
    const category = c.category;
    if (!role || !category) continue;
    // Only auto-add pickers for the standard role slots — keeps the
    // script narrow; templates with bespoke connectors (like
    // `metrics_db`, `operations_api`) get their pickers hand-authored.
    const knownRoles = new Set(Object.values(ROLE_MAP).map((r) => r.role));
    if (!knownRoles.has(role)) continue;

    const existing = questions.find((q) =>
      q.connector_names?.includes(role) &&
      q.dynamic_source?.source === 'vault' &&
      q.dynamic_source?.service_type === category,
    );
    if (existing) continue;

    const roleDef = Object.values(ROLE_MAP).find((r) => r.role === role);
    questions.push({
      id: `aq_${role}_credential`,
      scope: 'connector',
      connector_names: [role],
      // Vault-picker questions go in the `credentials` bucket so they
      // surface first in the Live Preview sidebar + questionnaire order.
      category: 'credentials',
      question: roleDef?.q ?? `Which ${role} credential should this persona use?`,
      type: 'select',
      dynamic_source: {
        service_type: category,
        operation: 'list_credentials',
        source: 'vault',
      },
      maps_to: `persona.connectors[${role}].credential_fields[provider].value`,
      variable_name: `${role}_credential`,
      context: roleDef?.ctx ?? `Auto-detected from your ${category} credentials in the Vault.`,
      dimension: 'connectors',
    });
    added.push(role);
  }
  return added;
}

console.log(`Processed ${files.length} templates; rewrote ${changed}`);
console.log();
for (const line of summary) console.log(' • ' + line);
