#!/usr/bin/env node
/**
 * Apply the v3.1 multi-tag taxonomy to scripts/connectors/builtin/*.json.
 *
 * The frontend's `connectorCategoryTags()` helper (src/lib/credentials/
 * builtinConnectors.ts) unions `category` (string) with `categories`
 * (string[]). Templates match connectors via `dynamic_source.service_type`
 * against this union. Adding `categories` to a connector makes it eligible
 * for additional vault-picker slots without changing the Rust seed's
 * singular `category` field.
 *
 * Run with:
 *   node scripts/apply-connector-multi-tags.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, 'connectors', 'builtin');

// Category fixes — the current singular `category` has a few mis-tags the
// template pass depends on. Where this map has a value, the primary
// `category` field is rewritten. Additional tags land in `categories`.
const PRIMARY_CATEGORY_FIXES = {
  google_ads: 'advertising',          // was 'analytics' — it's an ad platform
  twilio_sms: 'messaging',            // was 'email' — SMS is messaging
  onedrive: 'storage',                // was 'productivity' — it's cloud storage
  codebase: 'development',            // was 'integration' — local codebase access
  codebases: 'development',           // was 'integration' — aggregate codebase access
};

// Secondary tags per connector. Every connector gets this set added to the
// `categories` array (merged with the current primary). Unlisted connectors
// get `categories: [category]` (single-element) so the field exists
// uniformly across the catalog.
const SECONDARY_TAGS = {
  // ─── AI / media generation ──────────────────────────────────────────
  elevenlabs:      ['audio_generation', 'tts', 'voice_generation', 'ai'],
  deepgram:        ['speech_to_text', 'transcription', 'audio_intelligence', 'ai'],
  leonardo_ai:     ['image_generation', 'video_generation', 'ai'],
  google_gemini:   ['ai_chat', 'text_generation', 'ai'],
  gemini_vision:   ['vision', 'ocr', 'image_generation', 'ai'],

  // ─── Database / spreadsheet / knowledge ─────────────────────────────
  airtable:              ['spreadsheet', 'database', 'project_management'],
  google_sheets:         ['spreadsheet', 'database'],
  microsoft_excel:       ['spreadsheet', 'database'],
  notion:                ['knowledge_base', 'documentation', 'wiki', 'database'],
  confluence:            ['knowledge_base', 'documentation', 'wiki', 'productivity'],
  obsidian:              ['knowledge_base', 'note_taking', 'productivity'],
  desktop_obsidian:      ['knowledge_base', 'note_taking', 'productivity'],
  obsidian_memory:       ['knowledge_base', 'vector_search'],
  personas_vector_db:    ['vector_search', 'knowledge_base', 'database'],
  personas_database:     ['local_storage', 'database'],
  sharepoint:            ['knowledge_base', 'storage', 'collaboration', 'productivity'],
  convex:                ['database', 'backend_as_service'],
  supabase:              ['database', 'backend_as_service', 'auth'],
  duckdb:                ['database', 'analytics'],
  neon:                  ['database'],
  postgres:              ['database'],
  mongodb:               ['database'],
  redis:                 ['database', 'cache'],
  upstash:               ['database', 'cache'],
  planetscale:           ['database'],

  // ─── Email / messaging / calendar ───────────────────────────────────
  gmail:                 ['email', 'google_workspace'],
  microsoft_outlook:     ['email', 'microsoft365', 'calendar'],
  sendgrid:              ['email', 'transactional_email'],
  resend:                ['email', 'transactional_email'],
  twilio_sms:            ['messaging', 'sms'],
  google_workspace_oauth_template: ['email', 'storage', 'calendar', 'productivity'],
  slack:                 ['messaging', 'chat', 'team_messaging'],
  discord:               ['messaging', 'chat', 'community'],
  telegram:              ['messaging', 'chat'],
  microsoft_teams:       ['messaging', 'chat', 'microsoft365'],
  personas_messages:     ['messaging', 'in_app_notifications'],
  google_calendar:       ['scheduling', 'calendar'],
  microsoft_calendar:    ['scheduling', 'calendar'],
  cal_com:               ['scheduling', 'calendar', 'booking'],
  calendly:              ['scheduling', 'booking'],

  // ─── Social / content platforms ─────────────────────────────────────
  reddit:                ['social', 'social_feed'],
  x_twitter:             ['social', 'social_feed'],
  linkedin:              ['social', 'social_feed', 'professional_network'],
  youtube_data:          ['social', 'video_platform', 'media_feed'],
  buffer:                ['social', 'social_publishing', 'social_scheduling'],

  // ─── Storage ────────────────────────────────────────────────────────
  aws_s3:                ['storage'],
  cloudflare_r2:         ['storage'],
  backblaze_b2:          ['storage'],
  local_drive:           ['storage', 'local_storage'],
  google_drive:          ['storage', 'documents', 'collaboration', 'google_workspace'],
  dropbox:               ['storage'],
  onedrive:              ['storage', 'microsoft365'],

  // ─── Dev / source control / CI ─────────────────────────────────────
  github:                ['devops', 'source_control', 'development'],
  gitlab:                ['devops', 'source_control', 'development'],
  azure_devops:          ['devops', 'source_control', 'ci_cd'],
  circleci:              ['devops', 'ci_cd'],
  github_actions:        ['automation', 'ci_cd', 'source_control'],
  codebase:              ['development', 'source_code'],
  codebases:             ['development', 'source_code'],
  desktop_docker:        ['devops', 'containers', 'local_runtime'],
  desktop_browser:       ['desktop', 'browser_automation'],

  // ─── Project mgmt / ticketing ───────────────────────────────────────
  jira:                  ['project_management', 'issue_tracker', 'ticketing'],
  linear:                ['project_management', 'issue_tracker', 'ticketing'],
  asana:                 ['project_management'],
  monday:                ['project_management', 'crm'],
  clickup:               ['project_management', 'documentation', 'time_tracking'],

  // ─── CRM ────────────────────────────────────────────────────────────
  hubspot:               ['crm', 'marketing_automation', 'sales_pipeline'],
  attio:                 ['crm'],
  pipedrive:             ['crm', 'sales_pipeline'],

  // ─── Monitoring / observability ─────────────────────────────────────
  sentry:                ['monitoring', 'observability', 'error_tracking'],
  betterstack:           ['monitoring', 'observability', 'uptime'],

  // ─── Finance ────────────────────────────────────────────────────────
  alpha_vantage:         ['finance', 'market_data'],
  kalshi:                ['finance', 'market_data', 'prediction_markets'],
  stripe:                ['finance', 'payments', 'billing', 'subscriptions', 'ecommerce'],
  ramp:                  ['finance', 'accounting', 'expense_management'],
  lemonsqueezy:          ['ecommerce', 'payments', 'billing'],
  woocommerce:           ['ecommerce'],

  // ─── Analytics / BI / advertising ───────────────────────────────────
  google_ads:            ['advertising', 'analytics'],
  meta_ads:              ['advertising'],
  linkedin_ads:          ['advertising'],
  mixpanel:              ['analytics', 'product_analytics'],
  posthog:               ['analytics', 'product_analytics', 'feature_flags', 'session_replay'],
  humbalytics:           ['analytics', 'web_analytics', 'experimentation'],
  redash:                ['analytics', 'bi', 'sql'],
  metabase:              ['analytics', 'bi', 'sql'],
  twilio_segment:        ['analytics', 'cdp', 'event_tracking'],

  // ─── Forms / surveys / support ──────────────────────────────────────
  formbricks:            ['forms', 'surveys', 'feedback'],
  tally:                 ['forms', 'surveys'],
  crisp:                 ['support', 'messaging', 'chat', 'customer_support'],

  // ─── Notifications ──────────────────────────────────────────────────
  knock:                 ['notifications'],
  novu:                  ['notifications'],
  ntfy:                  ['notifications'],

  // ─── Automation / scraping / integration ───────────────────────────
  apify:                 ['automation', 'browser_automation', 'scraping', 'data_extraction'],
  firecrawl:             ['integration', 'web_scraping', 'data_extraction'],
  n8n:                   ['automation', 'workflow_automation'],
  zapier:                ['automation', 'workflow_automation'],
  arcade:                ['integration', 'mcp_gateway'],
  mcp_gateway:           ['integration', 'mcp_gateway'],

  // ─── Research / academic ────────────────────────────────────────────
  arxiv:                 ['research', 'academic_papers'],
  pubmed:                ['research', 'academic_papers'],
  semantic_scholar:      ['research', 'academic_papers'],
  news_api:              ['research', 'news_feed'],

  // ─── Design ─────────────────────────────────────────────────────────
  canva:                 ['design'],
  figma:                 ['design'],
  penpot:                ['design'],

  // ─── Time tracking ─────────────────────────────────────────────────
  clockify:              ['time_tracking'],
  harvest:               ['time_tracking'],
  toggl:                 ['time_tracking'],

  // ─── Cloud infra ───────────────────────────────────────────────────
  aws_cloud:             ['cloud'],
  azure_cloud:           ['cloud', 'microsoft365'],
  gcp_cloud:             ['cloud', 'google_workspace'],
  cloudflare:            ['cloud'],
  digitalocean:          ['cloud'],
  fly_io:                ['cloud'],
  kubernetes:            ['cloud', 'containers'],
  netlify:               ['cloud'],
  railway:               ['cloud'],
  vercel:                ['cloud'],

  // ─── Personalisation ───────────────────────────────────────────────
  twin:                  ['personalization'],
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
let changed = 0;

for (const f of files) {
  const p = join(DIR, f);
  const raw = readFileSync(p, 'utf-8');
  const data = JSON.parse(raw);
  const name = data.name;

  let dirty = false;

  // Fix primary category where we have a documented correction.
  if (PRIMARY_CATEGORY_FIXES[name] && data.category !== PRIMARY_CATEGORY_FIXES[name]) {
    data.category = PRIMARY_CATEGORY_FIXES[name];
    dirty = true;
  }

  // Compose the categories array: primary + per-connector secondary tags,
  // deduped. Every connector ends up with `categories: [...]` even if the
  // list is just [primary] — makes the shape uniform for the frontend.
  const primary = data.category;
  const secondary = SECONDARY_TAGS[name] ?? [];
  const merged = Array.from(new Set([primary, ...secondary]));

  const existing = Array.isArray(data.categories) ? data.categories : null;
  const unchanged = existing &&
    existing.length === merged.length &&
    existing.every((t, i) => t === merged[i]);

  if (!unchanged) {
    data.categories = merged;
    dirty = true;
  }

  if (dirty) {
    // Re-order keys so `categories` sits right after `category` for easy
    // diffing. Preserve all other fields in their original order.
    const entries = Object.entries(data);
    const ordered = {};
    for (const [k, v] of entries) {
      if (k === 'categories') continue; // inject in the right spot below
      ordered[k] = v;
      if (k === 'category') ordered.categories = data.categories;
    }
    // If `category` wasn't present for some reason, append `categories` at end.
    if (!Object.prototype.hasOwnProperty.call(ordered, 'categories')) {
      ordered.categories = data.categories;
    }
    writeFileSync(p, JSON.stringify(ordered, null, 2) + '\n', 'utf-8');
    changed++;
  }
}

console.log(`Processed ${files.length} connectors; rewrote ${changed}`);
