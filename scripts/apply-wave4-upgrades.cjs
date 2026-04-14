#!/usr/bin/env node
/**
 * Wave 4 template upgrades — one-off patcher for the 10 templates unblocked
 * by the discovery engine extensions (POST body, custom headers, Atlassian
 * Basic Auth, Google OAuth routing).
 *
 * Each entry is fully specified: no regex, no heuristics, just an explicit
 * (file, question_id) → patch mapping derived from the hand-audit. Idempotent:
 * questions that already carry a `dynamic_source` are left alone.
 *
 * Run once after pulling the Wave 4 engine extensions; safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const UPGRADES = [
  // ---- Jira ----
  {
    file: 'development/autonomous-issue-resolver.json',
    id: 'jira_projects',
    patch: {
      type: 'select',
      vault_category: 'project-mgmt',
      option_service_types: ['jira'],
      dynamic_source: { service_type: 'jira', operation: 'list_projects', multi: true },
    },
  },

  // ---- Notion ----
  {
    file: 'development/autonomous-issue-resolver.json',
    id: 'notion_kb_database_id',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['notion'],
      dynamic_source: { service_type: 'notion', operation: 'list_databases' },
    },
  },
  {
    file: 'content/content-approval-workflow.json',
    id: 'aq_credentials_1',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['notion'],
      dynamic_source: { service_type: 'notion', operation: 'list_databases' },
    },
  },

  // ---- Linear ----
  {
    file: 'development/design-handoff-coordinator.json',
    id: 'aq_credentials_1',
    patch: {
      type: 'select',
      vault_category: 'project-mgmt',
      option_service_types: ['linear'],
      dynamic_source: { service_type: 'linear', operation: 'list_teams' },
    },
  },
  {
    file: 'support/customer-feedback-router.json',
    id: 'aq_credentials_1',
    patch: {
      type: 'select',
      vault_category: 'project-mgmt',
      option_service_types: ['linear'],
      dynamic_source: { service_type: 'linear', operation: 'list_teams' },
    },
  },

  // ---- Google Drive ----
  {
    file: 'content/ai-document-intelligence-hub.json',
    id: 'aq_configuration_1',
    patch: {
      type: 'select',
      vault_category: 'productivity',
      option_service_types: ['google_workspace_oauth_template'],
      dynamic_source: {
        service_type: 'google_workspace_oauth_template',
        operation: 'list_drive_folders',
        multi: true,
      },
    },
  },

  // ---- Google Sheets ----
  {
    file: 'finance/expense-receipt-processor.json',
    id: 'expense_sheet',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['google_sheets'],
      dynamic_source: { service_type: 'google_sheets', operation: 'list_sheets' },
    },
  },
  {
    file: 'sales/outbound-sales-intelligence-pipeline.json',
    id: 'sheet_url',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['google_sheets'],
      dynamic_source: { service_type: 'google_sheets', operation: 'list_sheets' },
    },
  },
  {
    file: 'research/website-market-intelligence-profiler.json',
    id: 'spreadsheet_url',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['google_sheets'],
      dynamic_source: { service_type: 'google_sheets', operation: 'list_sheets' },
    },
  },
  {
    file: 'sales/sheets-e-commerce-command-center.json',
    id: 'aq_credentials_1',
    patch: {
      type: 'select',
      vault_category: 'database',
      option_service_types: ['google_sheets'],
      dynamic_source: { service_type: 'google_sheets', operation: 'list_sheets' },
    },
  },

  // ---- Gmail ----
  {
    file: 'legal/ai-contract-reviewer.json',
    id: 'gmail_label',
    patch: {
      type: 'select',
      vault_category: 'email',
      option_service_types: ['gmail'],
      dynamic_source: { service_type: 'gmail', operation: 'list_gmail_labels' },
    },
  },
];

const root = path.join(__dirname, '..', 'scripts', 'templates');

let patched = 0;
let skipped = 0;
const byFile = new Map();
for (const u of UPGRADES) {
  if (!byFile.has(u.file)) byFile.set(u.file, []);
  byFile.get(u.file).push(u);
}

for (const [relFile, ups] of byFile) {
  const abs = path.join(root, relFile);
  const j = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const aqs = j.payload.adoption_questions;
  for (const u of ups) {
    const q = aqs.find((x) => x.id === u.id);
    if (!q) {
      console.error(`MISSING: ${relFile} :: ${u.id}`);
      continue;
    }
    if (q.dynamic_source) {
      skipped++;
      console.log(`skip (already dynamic): ${relFile} :: ${u.id}`);
      continue;
    }
    delete q.placeholder;
    Object.assign(q, u.patch);
    patched++;
    console.log(`patched: ${relFile} :: ${u.id} -> ${u.patch.dynamic_source.service_type}.${u.patch.dynamic_source.operation}`);
  }
  fs.writeFileSync(abs, JSON.stringify(j, null, 2) + '\n', 'utf8');
}

console.log(`\nTOTAL: ${patched} patched, ${skipped} skipped`);
