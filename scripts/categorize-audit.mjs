#!/usr/bin/env node
/**
 * One-shot audit: normalizes connector + template category tagging.
 *
 * Writes:
 *   - src/lib/config/connector-categories.json  (canonical catalog)
 *   - scripts/connectors/builtin/*.json         (connector primary + categories[])
 *   - scripts/templates/**\/*.json              (slot categories + service_types)
 *
 * Single level categories (no nesting). Snake_case everywhere.
 * Multi-tag: a connector may claim multiple categories (e.g. Leonardo AI -> ai, image_generation, video_generation).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. CANONICAL CATEGORY CATALOG
// ---------------------------------------------------------------------------
// Keys are snake_case. `builtIn: true` = no external credential needed.
const CATEGORIES = {
  // --- Communication ------------------------------------------------------
  messaging:         { label: 'Messaging',         color: '#6366f1', icon: 'MessageSquare', builtIn: true },
  email:             { label: 'Email',             color: '#ef4444', icon: 'Mail' },
  notifications:     { label: 'Notifications',     color: '#FF4981', icon: 'Bell' },
  scheduling:        { label: 'Scheduling',        color: '#006BFF', icon: 'Calendar' },
  calendar:          { label: 'Calendar',          color: '#0EA5E9', icon: 'CalendarDays' },

  // --- Data & storage -----------------------------------------------------
  database:          { label: 'Database',          color: '#06b6d4', icon: 'Database', builtIn: true },
  spreadsheet:       { label: 'Spreadsheet',       color: '#16A34A', icon: 'Table' },
  storage:           { label: 'Storage',           color: '#569A31', icon: 'HardDrive' },
  cache:             { label: 'Cache',             color: '#F97316', icon: 'Zap' },
  vector_search:     { label: 'Vector Search',     color: '#8B5CF6', icon: 'Search', builtIn: true },
  knowledge_base:    { label: 'Knowledge Base',    color: '#A855F7', icon: 'BookOpen' },
  documentation:     { label: 'Documentation',     color: '#4353FF', icon: 'BookText' },

  // --- AI -----------------------------------------------------------------
  ai:                { label: 'AI',                color: '#6C3AEF', icon: 'Bot' },
  image_generation:  { label: 'Image AI',          color: '#EC4899', icon: 'Image' },
  video_generation:  { label: 'Video AI',          color: '#F43F5E', icon: 'Video' },
  voice_generation:  { label: 'Voice AI',          color: '#DB2777', icon: 'Mic' },
  transcription:     { label: 'Transcription',     color: '#C026D3', icon: 'AudioLines' },
  vision:            { label: 'Vision',            color: '#7C3AED', icon: 'Eye' },

  // --- Dev & infra --------------------------------------------------------
  source_control:    { label: 'Source Control',    color: '#334155', icon: 'GitBranch' },
  ci_cd:             { label: 'CI/CD',             color: '#8b5cf6', icon: 'Workflow' },
  devops:            { label: 'DevOps',            color: '#8b5cf6', icon: 'Code2' },
  containers:        { label: 'Containers',        color: '#2496ED', icon: 'Box' },
  cloud:             { label: 'Cloud',             color: '#3b82f6', icon: 'Cloud' },
  monitoring:        { label: 'Monitoring',        color: '#14b8a6', icon: 'Activity' },
  development:       { label: 'Development',       color: '#1e293b', icon: 'Terminal' },
  desktop:           { label: 'Desktop',           color: '#64748B', icon: 'Monitor' },

  // --- Business / domain --------------------------------------------------
  crm:               { label: 'CRM',               color: '#f97316', icon: 'Users' },
  project_management:{ label: 'Project Mgmt',      color: '#0ea5e9', icon: 'Kanban' },
  ticketing:         { label: 'Ticketing',         color: '#F59E0B', icon: 'Ticket' },
  support:           { label: 'Support',           color: '#0891b2', icon: 'LifeBuoy' },
  analytics:         { label: 'Analytics',         color: '#7856FF', icon: 'BarChart3' },
  bi:                { label: 'BI',                color: '#2563EB', icon: 'PieChart' },
  finance:           { label: 'Finance',           color: '#10b981', icon: 'CreditCard' },
  ecommerce:         { label: 'E-Commerce',        color: '#7AB55C', icon: 'ShoppingBag' },
  marketing:         { label: 'Marketing',         color: '#E11D48', icon: 'Megaphone' },
  advertising:       { label: 'Advertising',       color: '#DC2626', icon: 'TrendingUp' },
  social:            { label: 'Social',            color: '#ec4899', icon: 'Share2' },
  time_tracking:     { label: 'Time Tracking',     color: '#f59e0b', icon: 'Timer' },
  hr:                { label: 'HR',                color: '#9333EA', icon: 'Briefcase' },
  legal:             { label: 'Legal',             color: '#475569', icon: 'Scale' },
  security:          { label: 'Security',          color: '#DC2626', icon: 'ShieldCheck' },
  research:          { label: 'Research',          color: '#0891B2', icon: 'Microscope' },

  // --- Tools / utilities --------------------------------------------------
  productivity:      { label: 'Productivity',      color: '#eab308', icon: 'FileText' },
  forms:             { label: 'Forms',             color: '#3CCF91', icon: 'ClipboardList' },
  design:            { label: 'Design',            color: '#F24E1E', icon: 'Layout' },
  cms:               { label: 'CMS',               color: '#4353FF', icon: 'Globe' },
  automation:        { label: 'Automation',        color: '#F97316', icon: 'Cable' },
  integration:       { label: 'Integration',       color: '#14B8A6', icon: 'Plug' },
  web_scraping:      { label: 'Web Scraping',      color: '#0D9488', icon: 'Download' },
  browser_automation:{ label: 'Browser Automation',color: '#475569', icon: 'MousePointer2' },
  personalization:   { label: 'Personalization',   color: '#D946EF', icon: 'UserCircle' },
};

// ---------------------------------------------------------------------------
// 2. PER-CONNECTOR EXPLICIT MULTI-TAG MAP
// ---------------------------------------------------------------------------
// Format: connector_name -> { primary, tags:[...extra tags beyond primary] }
// The full categories[] array = [primary, ...tags] unique.
const CONNECTORS = {
  // Messaging
  slack:              { primary: 'messaging', tags: [] },
  discord:            { primary: 'messaging', tags: [] },
  telegram:           { primary: 'messaging', tags: [] },
  microsoft_teams:    { primary: 'messaging', tags: [] },
  twilio_sms:         { primary: 'messaging', tags: ['notifications'] },
  crisp:              { primary: 'support',   tags: ['messaging'] },
  local_messaging:    { primary: 'messaging', tags: [] },
  personas_messages:  { primary: 'messaging', tags: ['notifications'] },
  personas_vector_db: { primary: 'vector_search', tags: ['knowledge_base', 'database'] },

  // Email
  gmail:              { primary: 'email',     tags: [] },
  microsoft_outlook:  { primary: 'email',     tags: ['calendar'] },
  sendgrid:           { primary: 'email',     tags: [] },
  resend:             { primary: 'email',     tags: [] },

  // Notifications
  novu:               { primary: 'notifications', tags: [] },
  knock:              { primary: 'notifications', tags: [] },
  ntfy:               { primary: 'notifications', tags: [] },

  // Scheduling / calendar
  google_calendar:    { primary: 'calendar',   tags: ['scheduling'] },
  microsoft_calendar: { primary: 'calendar',   tags: ['scheduling'] },
  cal_com:            { primary: 'scheduling', tags: ['calendar'] },
  calendly:           { primary: 'scheduling', tags: ['calendar'] },

  // Database
  personas_database:  { primary: 'database',  tags: ['storage'] },
  supabase:           { primary: 'database',  tags: [] },
  neon:               { primary: 'database',  tags: [] },
  postgres:           { primary: 'database',  tags: [] },
  convex:             { primary: 'database',  tags: [] },
  upstash:            { primary: 'database',  tags: ['cache'] },
  mongodb:            { primary: 'database',  tags: [] },
  redis:              { primary: 'database',  tags: ['cache'] },
  planetscale:        { primary: 'database',  tags: [] },
  duckdb:             { primary: 'database',  tags: ['analytics'] },

  // Spreadsheet
  google_sheets:      { primary: 'spreadsheet', tags: ['database'] },
  microsoft_excel:    { primary: 'spreadsheet', tags: ['database'] },
  airtable:           { primary: 'spreadsheet', tags: ['database', 'project_management'] },

  // Storage
  aws_s3:             { primary: 'storage', tags: [] },
  cloudflare_r2:      { primary: 'storage', tags: [] },
  backblaze_b2:       { primary: 'storage', tags: [] },
  dropbox:            { primary: 'storage', tags: [] },
  google_drive:       { primary: 'storage', tags: ['productivity'] },
  onedrive:           { primary: 'storage', tags: ['productivity'] },
  local_drive:        { primary: 'storage', tags: [] },

  // Knowledge base
  notion:             { primary: 'knowledge_base', tags: ['database', 'documentation', 'productivity'] },
  confluence:         { primary: 'knowledge_base', tags: ['documentation', 'productivity'] },
  sharepoint:         { primary: 'knowledge_base', tags: ['storage', 'productivity'] },
  obsidian:           { primary: 'knowledge_base', tags: ['productivity'] },
  desktop_obsidian:   { primary: 'knowledge_base', tags: ['productivity', 'desktop'] },
  obsidian_memory:    { primary: 'knowledge_base', tags: ['vector_search'] },
  vector_knowledge_base: { primary: 'vector_search', tags: ['knowledge_base', 'database'] },

  // AI (general)
  google_gemini:      { primary: 'ai', tags: [] },
  // AI + image
  leonardo_ai:        { primary: 'ai', tags: ['image_generation', 'video_generation'] },
  // AI + vision
  gemini_vision:      { primary: 'ai', tags: ['vision', 'image_generation'] },
  // AI + voice / transcription
  elevenlabs:         { primary: 'ai', tags: ['voice_generation'] },
  deepgram:           { primary: 'ai', tags: ['transcription', 'voice_generation'] },

  // Source control / devops
  github:             { primary: 'source_control', tags: ['development', 'ci_cd', 'devops'] },
  gitlab:             { primary: 'source_control', tags: ['development', 'ci_cd', 'devops'] },
  azure_devops:       { primary: 'source_control', tags: ['ci_cd', 'devops'] },
  github_actions:     { primary: 'ci_cd',          tags: ['automation', 'devops'] },
  circleci:           { primary: 'ci_cd',          tags: ['devops'] },
  desktop_docker:     { primary: 'containers',     tags: ['devops', 'desktop'] },
  kubernetes:         { primary: 'containers',     tags: ['cloud', 'devops'] },

  // Cloud
  aws_cloud:          { primary: 'cloud', tags: [] },
  azure_cloud:        { primary: 'cloud', tags: [] },
  gcp_cloud:          { primary: 'cloud', tags: [] },
  vercel:             { primary: 'cloud', tags: ['devops'] },
  netlify:            { primary: 'cloud', tags: ['devops'] },
  cloudflare:         { primary: 'cloud', tags: [] },
  fly_io:             { primary: 'cloud', tags: ['devops'] },
  railway:            { primary: 'cloud', tags: ['devops'] },
  digitalocean:       { primary: 'cloud', tags: [] },

  // Monitoring
  sentry:             { primary: 'monitoring', tags: ['development'] },
  betterstack:        { primary: 'monitoring', tags: [] },

  // Dev tooling
  codebase:           { primary: 'development', tags: ['source_control', 'desktop'] },
  codebases:          { primary: 'development', tags: ['source_control', 'desktop'] },
  desktop_browser:    { primary: 'browser_automation', tags: ['desktop'] },

  // Project mgmt / ticketing
  jira:               { primary: 'project_management', tags: ['ticketing'] },
  linear:             { primary: 'project_management', tags: ['ticketing'] },
  asana:              { primary: 'project_management', tags: [] },
  clickup:            { primary: 'project_management', tags: ['documentation', 'time_tracking'] },
  monday:             { primary: 'project_management', tags: ['crm'] },

  // CRM
  hubspot:            { primary: 'crm', tags: ['marketing', 'email'] },
  pipedrive:          { primary: 'crm', tags: [] },
  attio:              { primary: 'crm', tags: [] },

  // Analytics / BI
  mixpanel:           { primary: 'analytics', tags: [] },
  posthog:            { primary: 'analytics', tags: ['monitoring'] },
  twilio_segment:     { primary: 'analytics', tags: [] },
  humbalytics:        { primary: 'analytics', tags: [] },
  metabase:           { primary: 'bi',        tags: ['analytics'] },
  redash:             { primary: 'bi',        tags: ['analytics'] },

  // Finance
  stripe:             { primary: 'finance', tags: ['ecommerce'] },
  ramp:               { primary: 'finance', tags: [] },
  alpha_vantage:      { primary: 'finance', tags: ['research'] },
  kalshi:             { primary: 'finance', tags: ['research'] },
  lemonsqueezy:       { primary: 'ecommerce', tags: ['finance'] },
  woocommerce:        { primary: 'ecommerce', tags: [] },

  // Marketing / advertising / social
  google_ads:         { primary: 'advertising', tags: ['marketing'] },
  meta_ads:           { primary: 'advertising', tags: ['marketing', 'social'] },
  linkedin_ads:       { primary: 'advertising', tags: ['marketing', 'social'] },
  buffer:             { primary: 'social',      tags: ['marketing'] },
  linkedin:           { primary: 'social',      tags: [] },
  reddit:             { primary: 'social',      tags: ['research'] },
  x_twitter:          { primary: 'social',      tags: ['research'] },
  youtube_data:       { primary: 'social',      tags: ['research'] },

  // Time tracking
  toggl:              { primary: 'time_tracking', tags: [] },
  clockify:           { primary: 'time_tracking', tags: [] },
  harvest:            { primary: 'time_tracking', tags: ['finance'] },

  // Design
  figma:              { primary: 'design', tags: [] },
  canva:              { primary: 'design', tags: ['image_generation'] },
  penpot:             { primary: 'design', tags: [] },

  // Forms
  tally:              { primary: 'forms', tags: [] },
  formbricks:         { primary: 'forms', tags: ['analytics'] },

  // Research
  arxiv:              { primary: 'research', tags: [] },
  pubmed:             { primary: 'research', tags: [] },
  semantic_scholar:   { primary: 'research', tags: [] },
  news_api:           { primary: 'research', tags: [] },

  // Automation / integration
  n8n:                { primary: 'automation', tags: ['integration'] },
  zapier:             { primary: 'automation', tags: ['integration'] },
  arcade:             { primary: 'integration', tags: [] },
  mcp_gateway:        { primary: 'integration', tags: [] },
  apify:              { primary: 'web_scraping', tags: ['automation', 'browser_automation'] },
  firecrawl:          { primary: 'web_scraping', tags: ['research'] },

  // Special
  twin:               { primary: 'personalization', tags: [] },

  // Google Workspace bundle template (multi-role)
  google_workspace_oauth_template: { primary: 'productivity', tags: ['email', 'storage', 'calendar'] },
};

// ---------------------------------------------------------------------------
// 3. TEMPLATE SLOT NORMALIZATION
// ---------------------------------------------------------------------------
// Map legacy / variant keys to the canonical catalog key.
const KEY_REWRITE = {
  'project-mgmt':        'project_management',
  'time-tracking':       'time_tracking',
  'project-management':  'project_management',   // top-level folder-style
  'time-tracking':       'time_tracking',
  'project_tracking':    'project_management',
  'issue_tracker':       'ticketing',
  'tts':                 'voice_generation',
  'stt':                 'transcription',
  'speech_to_text':      'transcription',
  'audio_intelligence':  'transcription',
  'audio_generation':    'voice_generation',
  'text_generation':     'ai',
  'ai_chat':             'ai',
  'ocr':                 'vision',
  'media_feed':          'social',
  'social_feed':         'social',
  'social_publishing':   'social',
  'social_scheduling':   'social',
  'professional_network':'social',
  'chat':                'messaging',
  'in_app_notifications':'notifications',
  'team_messaging':      'messaging',
  'community':           'messaging',
  'sms':                 'messaging',
  'transactional_email': 'email',
  'browser':             'browser_automation',
  'data_extraction':     'web_scraping',
  'scraping':            'web_scraping',
  'workflow_automation': 'automation',
  'payments':            'finance',
  'billing':             'finance',
  'subscriptions':       'finance',
  'accounting':          'finance',
  'expense_management':  'finance',
  'market_data':         'research',
  'prediction_markets':  'research',
  'academic_papers':     'research',
  'news_feed':           'research',
  'enrichment':          'crm',
  'sales_pipeline':      'crm',
  'marketing_automation':'marketing',
  'customer_support':    'support',
  'error_tracking':      'monitoring',
  'observability':       'monitoring',
  'uptime':              'monitoring',
  'product_analytics':   'analytics',
  'web_analytics':       'analytics',
  'experimentation':     'analytics',
  'feature_flags':       'analytics',
  'session_replay':      'analytics',
  'cdp':                 'analytics',
  'event_tracking':      'analytics',
  'sql':                 'bi',
  'google_workspace':    'productivity',
  'microsoft365':        'productivity',
  'collaboration':       'productivity',
  'documents':           'productivity',
  'note_taking':         'knowledge_base',
  'wiki':                'knowledge_base',
  'knowledge':           'knowledge_base',
  'backend_as_service':  'database',
  'auth':                'security',
  'local_storage':       'storage',
  'local_runtime':       'desktop',
  'source_code':         'development',
  'surveys':             'forms',
  'feedback':            'forms',
  'booking':             'scheduling',
  'content':             'productivity',   // template domain bleed-through
  'creativity':          'design',
  'personalization':     'personalization',
  'mcp_gateway':         'integration',
  'video_platform':      'social',
  'cloud_billing':       'cloud',
  'google_sheets':       'spreadsheet',
  'codebases':           'development',
  'codebase':            'development',
  'slack':               'messaging',
  'notion':              'knowledge_base',
  'jira':                'ticketing',
  'linear':              'ticketing',
  'hubspot':             'crm',
  'advertising':         'advertising',
  'time_tracking':       'time_tracking',
};

function rewriteKey(k) {
  if (!k) return k;
  return KEY_REWRITE[k] ?? k;
}

// Top-level template.category uses domain keywords that we KEEP as-is (they are
// template-folder / domain tags, separate from architectural categories).
// Just normalize dashes to snake where equivalents exist.
const TEMPLATE_TOP_LEVEL_REWRITE = {
  'project-management': 'project_management',
  'time-tracking':      'time_tracking',
};

// ---------------------------------------------------------------------------
// 4. WRITE connector-categories.json
// ---------------------------------------------------------------------------
function buildCategoriesJson() {
  const out = {
    _description: 'Single source of truth: maps connector names to architectural category keys. Snake_case only. Connectors may claim multiple categories via categories[] in their JSON; this map records the PRIMARY category used for pill color/icon.',
    categories: CATEGORIES,
    connectors: Object.fromEntries(
      Object.entries(CONNECTORS).map(([name, { primary }]) => [name, primary]),
    ),
  };
  const dest = path.join(ROOT, 'src/lib/config/connector-categories.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`wrote ${dest}`);
}

// ---------------------------------------------------------------------------
// 5. UPDATE connector JSONs
// ---------------------------------------------------------------------------
function updateConnectors() {
  const dir = path.join(ROOT, 'scripts/connectors/builtin');
  let touched = 0, missing = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const entry = CONNECTORS[j.name];
    if (!entry) {
      missing.push(j.name);
      continue;
    }
    const cats = Array.from(new Set([entry.primary, ...entry.tags])).filter(Boolean);
    const changed = j.category !== entry.primary || JSON.stringify(j.categories || []) !== JSON.stringify(cats);
    if (changed) {
      j.category = entry.primary;
      j.categories = cats;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
      touched++;
    }
  }
  console.log(`connectors touched: ${touched}`);
  if (missing.length) console.warn(`connectors without explicit mapping (left unchanged): ${missing.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 6. UPDATE templates
// ---------------------------------------------------------------------------
function* walkTemplates(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) yield* walkTemplates(p);
    else if (f.endsWith('.json')) yield p;
  }
}

function updateTemplates() {
  const dir = path.join(ROOT, 'scripts/templates');
  let touched = 0;
  for (const p of walkTemplates(dir)) {
    const raw = fs.readFileSync(p, 'utf8');
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    let changed = false;

    // Top-level category: array OR string. Normalize known rewrites.
    if (Array.isArray(j.category)) {
      const next = j.category.map((c) => TEMPLATE_TOP_LEVEL_REWRITE[c] ?? c);
      if (next.some((v, i) => v !== j.category[i])) { j.category = next; changed = true; }
    } else if (typeof j.category === 'string') {
      const next = TEMPLATE_TOP_LEVEL_REWRITE[j.category] ?? j.category;
      if (next !== j.category) { j.category = next; changed = true; }
    }

    // Per-slot connector category + adoption question service_type.
    const slots = j.payload?.persona?.connectors ?? [];
    for (const s of slots) {
      if (s.category) {
        const next = rewriteKey(s.category);
        if (next !== s.category) { s.category = next; changed = true; }
      }
    }
    const aqs = j.payload?.adoption_questions ?? [];
    for (const q of aqs) {
      const st = q.dynamic_source?.service_type;
      if (st) {
        const next = rewriteKey(st);
        if (next !== st) { q.dynamic_source.service_type = next; changed = true; }
      }
    }

    if (changed) {
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
      touched++;
    }
  }
  console.log(`templates touched: ${touched}`);
}

// ---------------------------------------------------------------------------
// 7. Emit report of unknown tags STILL present after normalization
// ---------------------------------------------------------------------------
function reportUnknown() {
  const dir = path.join(ROOT, 'scripts/templates');
  const unknownSlots = new Map();
  const unknownServiceTypes = new Map();
  for (const p of walkTemplates(dir)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    for (const s of j.payload?.persona?.connectors ?? []) {
      if (s.category && !CATEGORIES[s.category]) {
        unknownSlots.set(s.category, (unknownSlots.get(s.category) ?? 0) + 1);
      }
    }
    for (const q of j.payload?.adoption_questions ?? []) {
      const st = q.dynamic_source?.service_type;
      if (st && !CATEGORIES[st]) {
        // service_type may be a concrete connector name (slack, notion, jira) -- that's fine
        if (!CONNECTORS[st]) {
          unknownServiceTypes.set(st, (unknownServiceTypes.get(st) ?? 0) + 1);
        }
      }
    }
  }
  if (unknownSlots.size) {
    console.warn('slot categories STILL unknown after rewrite:');
    for (const [k, v] of [...unknownSlots.entries()].sort((a, b) => b[1] - a[1])) console.warn(`  ${v}\t${k}`);
  }
  if (unknownServiceTypes.size) {
    console.warn('service_types STILL unknown (not a category, not a connector):');
    for (const [k, v] of [...unknownServiceTypes.entries()].sort((a, b) => b[1] - a[1])) console.warn(`  ${v}\t${k}`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
buildCategoriesJson();
updateConnectors();
updateTemplates();
reportUnknown();
