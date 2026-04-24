#!/usr/bin/env node
/**
 * One-shot template connector normalization.
 *
 * Fixes template JSONs so every abstract (non-builtin) connector.name
 * equals a valid category key from src/lib/config/connector-categories.json.
 * Renames also propagate to use_cases[].connectors[] references and to
 * the connector's own `category` field when it's the renamed name.
 *
 * Also adds missing source/storage connectors flagged in review and
 * rewrites Gmail-specific wording to the universal "Email" in templates
 * that use the abstract `email` slot.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const cats = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/lib/config/connector-categories.json"), "utf8"),
);
const VALID_CATEGORIES = new Set(Object.keys(cats.categories));

const BUILTIN = new Set(
  fs
    .readdirSync(path.join(ROOT, "scripts/connectors/builtin"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "").replace(/-/g, "_")),
);

/**
 * Per-file rename rules. Map: <relative file> → { oldName: { name, category } }
 * When `category` is omitted, we keep whatever the existing category was
 * (because it's already valid); the key must always be the *current*
 * connector.name to rename.
 */
const RENAMES = {
  "content/analytics-content-distribution-use-case.json": {
    wordpress: { name: "cms", category: "cms" },
    google_analytics: { name: "analytics", category: "analytics" },
  },
  "content/audio-briefing-host.json": {
    tts_provider: { name: "voice_generation", category: "voice_generation" },
    ffmpeg_local: { name: "desktop", category: "desktop" },
  },
  "content/autonomous-art-director.json": {
    image_ai: { name: "image_generation", category: "image_generation" },
  },
  "content/content-performance-reporter.json": {
    metrics_db: { name: "database", category: "database" },
  },
  "content/demo-recorder.json": {
    desktop_terminal: { name: "desktop", category: "desktop" },
  },
  "content/feature-video-creator.json": {
    tts_api: { name: "voice_generation", category: "voice_generation" },
    video_composition_api: { name: "video_generation", category: "video_generation" },
  },
  "content/game-character-animator.json": {
    image_ai: { name: "image_generation", category: "image_generation" },
  },
  "content/newsletter-curator.json": {
    rss_web_sources: { name: "web_scraping", category: "web_scraping" },
    email_smtp: { name: "email", category: "email" },
  },
  "content/youtube-content-pipeline.json": {
    social_feed: { name: "social", category: "social" },
    desktop_terminal: { name: "desktop", category: "desktop" },
  },
  "development/feature-flag-governance-use-case.json": {
    launchdarkly: { name: "development", category: "development" },
  },
  "development/user-lifecycle-manager.json": {
    clerk: { name: "security", category: "security" },
  },
  "devops/devops-guardian.json": {
    deployment: { name: "cloud", category: "cloud" },
  },
  "devops/telegram-ops-command-center.json": {
    secondary_messaging: { name: "messaging", category: "messaging" },
    operations_api: { name: "devops", category: "devops" },
  },
  "finance/accounting-reconciliation-use-case.json": {
    xero: { name: "finance", category: "finance" },
  },
  "finance/budget-spending-monitor.json": {
    cloud_billing: { name: "cloud", category: "cloud" },
  },
  "finance/finance-controller.json": {
    quickbooks: { name: "finance", category: "finance" },
  },
  "finance/freelancer-invoice-autopilot.json": {
    invoice_storage: { name: "storage", category: "storage" },
  },
  "finance/personal-finance-use-case.json": {
    plaid: { name: "finance", category: "finance" },
  },
  "finance/subscription-billing-use-case.json": {
    paddle: { name: "finance", category: "finance" },
  },
  "hr/recruiting-pipeline-use-case.json": {
    greenhouse: { name: "hr", category: "hr" },
  },
  "legal/contract-lifecycle-use-case.json": {
    docusign: { name: "legal", category: "legal" },
  },
  "marketing/autonomous-cro-experiment-runner.json": {
    cro_backend: { name: "analytics", category: "analytics" },
  },
  "marketing/reddit-trend-digest.json": {
    social_feed: { name: "social", category: "social" },
  },
  "marketing/visual-brand-asset-factory.json": {
    image_ai: { name: "image_generation", category: "image_generation" },
    multimodal_ai: { name: "vision", category: "vision" },
  },
  "marketing/web-marketing.json": {
    ad_platform: { name: "advertising", category: "advertising" },
    analytics_tool: { name: "analytics", category: "analytics" },
  },
  "project-management/deadline-synchronizer.json": {
    trello: { name: "project_management", category: "project_management" },
  },
  "research/product-analytics-briefer.json": {
    analytics_tool: { name: "analytics", category: "analytics" },
  },
  "research/product-signal-detector.json": {
    analytics_tool: { name: "analytics", category: "analytics" },
    ticketing_tool: { name: "ticketing", category: "ticketing" },
  },
  "research/website-market-intelligence-profiler.json": {
    source_list: { name: "research", category: "research" },
  },
  "sales/lead-capture-pipeline.json": {
    typeform: { name: "forms", category: "forms" },
  },
  "sales/outbound-sales-intelligence-pipeline.json": {
    enrichment: { name: "crm", category: "crm" },
  },
  "sales/website-conversion-auditor.json": {
    browser: { name: "browser_automation", category: "browser_automation" },
  },
  "security/brand-protection-sentinel.json": {
    whoisxml: { name: "security", category: "security" },
  },
  "security/security-vulnerability-pipeline.json": {
    snyk: { name: "security", category: "security" },
  },
  "support/customer-feedback-router.json": {
    intercom: { name: "support", category: "support" },
  },
  "support/support-escalation-engine.json": {
    freshdesk: { name: "support", category: "support" },
  },
  "support/support-intelligence-use-case.json": {
    zendesk: { name: "support", category: "support" },
  },
};

function loadTemplate(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function saveTemplate(absPath, data) {
  const existing = fs.readFileSync(absPath, "utf8");
  const trailingNewline = existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2) + trailingNewline);
}

function dedupeByName(connectors) {
  const seen = new Map();
  for (const c of connectors) {
    if (!seen.has(c.name)) seen.set(c.name, c);
    else {
      const prev = seen.get(c.name);
      const mergedCats = new Set([
        ...(prev.categories ?? []),
        ...(c.categories ?? []),
      ]);
      if (mergedCats.size > 0) prev.categories = [...mergedCats];
    }
  }
  return [...seen.values()];
}

function applyRenames(template, renames) {
  const conns = template.payload?.persona?.connectors;
  if (!Array.isArray(conns)) return;

  for (const c of conns) {
    const rule = renames[c.name];
    if (!rule) continue;
    if (rule.category) c.category = rule.category;
    c.name = rule.name;
  }

  template.payload.persona.connectors = dedupeByName(conns);

  // Propagate to use_cases[].connectors[] (array of connector-name strings).
  const useCases = template.payload?.use_cases ?? [];
  for (const uc of useCases) {
    if (!Array.isArray(uc.connectors)) continue;
    uc.connectors = uc.connectors.map((n) => renames[n]?.name ?? n);
    uc.connectors = [...new Set(uc.connectors)];
  }
}

// --- File-specific extra fixes -------------------------------------------

function addConnectorIfMissing(template, connector) {
  const conns = template.payload?.persona?.connectors ?? [];
  if (conns.some((c) => c.name === connector.name)) return;
  conns.push(connector);
  template.payload.persona.connectors = conns;
}

function fixArtDirector(template) {
  // Add a storage slot so the agent can save generated images somewhere.
  addConnectorIfMissing(template, {
    name: "storage",
    label: "Cloud Storage",
    auth_type: "oauth2",
    role: "image_archive",
    category: "storage",
    categories: ["storage"],
    required: false,
    credential_fields: [],
    setup_instructions:
      "Attach any storage credential (Google Drive, Dropbox, OneDrive, S3, R2, local drive). Generated images and decision logs are archived here, keyed by brief id + timestamp.",
  });
}

function fixIncidentLogger(template) {
  // The template has no source connector — it relies on manual intake
  // via messaging. Add a monitoring slot so alerts/monitoring systems
  // can feed incidents in via webhook.
  addConnectorIfMissing(template, {
    name: "monitoring",
    label: "Monitoring / Alerting Source",
    auth_type: "api_key",
    role: "incident_source",
    category: "monitoring",
    categories: ["monitoring"],
    required: false,
    credential_fields: [],
    setup_instructions:
      "Optional. Attach any monitoring or alerting service (Sentry, BetterStack, Datadog, Grafana, PagerDuty, custom webhook) so production signals can open incidents automatically. Without a source, intake is manual via the messaging channel.",
  });
}

function fixInvoiceTracker(template) {
  // Rewrite Gmail-specific wording to the universal "Email" term while
  // keeping the abstract `email` connector slot intact.
  const persona = template.payload?.persona;
  if (!persona) return;

  const rewriteStr = (s) =>
    typeof s === "string"
      ? s
          .replace(/\bGmail account\b/g, "Email account")
          .replace(/\bthe Gmail inbox\b/gi, "the email inbox")
          .replace(/\bGmail inbox\b/g, "email inbox")
          .replace(/\bGmail labels\b/g, "email labels/folders")
          .replace(/\bGmail\b/g, "Email")
      : s;

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return rewriteStr(node);
  };

  template.payload = walk(template.payload);

  // Update top-level service_flow tags that name Gmail explicitly.
  const flows = template.service_flow;
  if (Array.isArray(flows)) {
    template.service_flow = flows.map((s) => (s === "Gmail" ? "Email" : s));
  }
  if (Array.isArray(template.payload.service_flow)) {
    template.payload.service_flow = template.payload.service_flow.map((s) =>
      s === "Gmail" ? "Email" : s,
    );
  }
}

// --- Post-run audit ------------------------------------------------------

function audit() {
  const issues = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        const d = loadTemplate(p);
        const conns = d.payload?.persona?.connectors ?? [];
        for (const c of conns) {
          if (!c.name) continue;
          if (!BUILTIN.has(c.name) && !VALID_CATEGORIES.has(c.name)) {
            issues.push({ file: path.relative(ROOT, p), name: c.name });
          }
        }
      }
    }
  }
  walk(path.join(ROOT, "scripts/templates"));
  return issues;
}

// --- Main ----------------------------------------------------------------

function main() {
  let changed = 0;
  for (const [rel, rules] of Object.entries(RENAMES)) {
    const abs = path.join(ROOT, "scripts/templates", rel);
    const t = loadTemplate(abs);
    applyRenames(t, rules);
    if (rel === "content/autonomous-art-director.json") fixArtDirector(t);
    if (rel === "finance/invoice-tracker.json") fixInvoiceTracker(t);
    saveTemplate(abs, t);
    changed++;
  }

  // Incident logger has no entry in RENAMES — patch it directly.
  const incidentPath = path.join(ROOT, "scripts/templates/devops/incident-logger.json");
  const incident = loadTemplate(incidentPath);
  fixIncidentLogger(incident);
  saveTemplate(incidentPath, incident);
  changed++;

  // Invoice tracker has no entry in RENAMES — patch it directly.
  const invPath = path.join(ROOT, "scripts/templates/finance/invoice-tracker.json");
  const inv = loadTemplate(invPath);
  fixInvoiceTracker(inv);
  saveTemplate(invPath, inv);
  changed++;

  console.log(`Patched ${changed} template files.`);

  const remaining = audit();
  if (remaining.length > 0) {
    console.log("\nRemaining unmapped connector names:");
    for (const i of remaining) console.log(`  ${i.file}  →  ${i.name}`);
    process.exit(1);
  } else {
    console.log("All connector names are valid categories or builtins. ✓");
  }
}

main();
