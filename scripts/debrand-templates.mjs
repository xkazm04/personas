#!/usr/bin/env node
/**
 * De-brand templates that use abstract connector slots.
 *
 * For every template:
 *   1. Determine which abstract slots are present (connector.name is a
 *      valid category key, not a builtin connector).
 *   2. Check the template does NOT also carry the builtin brand connector
 *      for that slot — if it does (e.g. gmail + email both present), the
 *      brand is intentional; leave the text alone.
 *   3. Apply slot-specific brand→generic rewrites to every string value
 *      in the template JSON (walking nested objects/arrays).
 *
 * Skipped fields (preserved verbatim): ids, variable names, maps_to
 * paths, event_type strings, cron expressions, sample_input values,
 * adoption question options, and field keys.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const BUILTIN = new Set(
  fs
    .readdirSync(path.join(ROOT, "scripts/connectors/builtin"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "").replace(/-/g, "_")),
);

// --- slot → { conflictingBuiltins, rewrites } ----------------------------
//
// Each rewrite entry is [regex, replacement]. Order matters — more specific
// phrases come first. `g` and `i` flags are always set. Watch for
// trailing-space / double-space hygiene after apply.

const SLOTS = {
  email: {
    conflicts: ["gmail", "microsoft_outlook", "sendgrid", "resend"],
    rewrites: [
      [/\b(?:Gmail|Outlook|Microsoft\s+Outlook)\s+API\b/gi, "email API"],
      [/\b(?:Gmail|Outlook)\s+labels?\/folders?\b/gi, "email labels/folders"],
      [/\b(?:Gmail|Outlook)\s+labels?\b/gi, "email tags/folders"],
      [/\b(?:Gmail|Outlook)\s+folders?\b/gi, "email folders"],
      [/\b(?:Gmail|Outlook)\s+filters?\b/gi, "email filters"],
      [/\b(?:Gmail|Outlook)\s+(?:inbox|account|thread|search|message|address)\b/gi, "email $&"],
      [/\bGmail\s+(inbox|account|thread|search|message|address)\b/gi, "email $1"],
      [/\bOutlook\s+(inbox|account|thread|search|message|address)\b/gi, "email $1"],
      [/\bin\s+Gmail\b/gi, "in email"],
      [/\bin\s+Outlook\b/gi, "in email"],
      [/\bfrom\s+Gmail\b/gi, "from email"],
      [/\bpolls?\s+Gmail\b/gi, (m) => m.replace(/Gmail/i, "email")],
      [/\bMicrosoft\s+Outlook\b/gi, "email"],
      [/\bGmail\b/g, "email"],
      [/\bOutlook\b/g, "email"],
    ],
  },

  messaging: {
    conflicts: ["slack", "discord", "telegram", "microsoft_teams", "twilio_sms", "crisp"],
    rewrites: [
      [/\bSlack\s+Block\s*Kit\b/gi, "messaging formatted layout"],
      [/\bBlock\s*Kit\b/g, "formatted messaging layout"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+channels?\b/gi, "messaging channels"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+threads?\b/gi, "messaging threads"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+DMs?\b/gi, "direct messages"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+messages?\b/gi, "messages"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+webhooks?\b/gi, "messaging webhooks"],
      [/\b(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\s+workspaces?\b/gi, "messaging workspaces"],
      [/\bpost(?:s|ed|ing)?\s+(?:to|via|on)\s+(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\b/gi, (m) => m.replace(/Slack|Discord|Telegram|Microsoft\s+Teams|Teams/i, "the messaging channel")],
      [/\b(?:via|to|on|in|through)\s+(?:Slack|Discord|Telegram|Microsoft\s+Teams|Teams)\b/gi, (m) => m.replace(/Slack|Discord|Telegram|Microsoft\s+Teams|Teams/i, "the messaging channel")],
      [/\bMicrosoft\s+Teams\b/g, "messaging"],
      [/\bSlack\b/g, "messaging"],
      [/\bDiscord\b/g, "messaging"],
      [/\bTelegram\b/g, "messaging"],
      [/\bTeams\b/g, "messaging"],
    ],
  },

  crm: {
    conflicts: ["hubspot", "pipedrive", "attio"],
    rewrites: [
      [/\b(?:Salesforce|HubSpot|Pipedrive|Attio)\s+(record|account|opportunity|contact|deal|pipeline|object)s?\b/gi, "CRM $1s"],
      [/\bSalesforce\b/g, "CRM"],
      [/\bHubSpot\b/g, "CRM"],
      [/\bPipedrive\b/g, "CRM"],
      [/\bAttio\b/g, "CRM"],
    ],
  },

  storage: {
    conflicts: ["aws_s3", "cloudflare_r2", "backblaze_b2", "dropbox", "google_drive", "onedrive", "local_drive"],
    rewrites: [
      [/\bGoogle\s+Drive\b/g, "cloud storage"],
      [/\bOneDrive\b/g, "cloud storage"],
      [/\bDropbox\b/g, "cloud storage"],
      [/\bAmazon\s+S3\b/g, "cloud storage"],
      [/\bAWS\s+S3\b/g, "cloud storage"],
      [/\bS3\s+bucket\b/gi, "storage bucket"],
      [/\bCloudflare\s+R2\b/g, "cloud storage"],
      [/\bBackblaze\s+B2\b/g, "cloud storage"],
    ],
  },

  spreadsheet: {
    conflicts: ["google_sheets", "microsoft_excel", "airtable"],
    rewrites: [
      [/\bGoogle\s+Sheets?\b/g, "spreadsheet"],
      [/\bMicrosoft\s+Excel\b/g, "spreadsheet"],
      [/\bExcel\b/g, "spreadsheet"],
      [/\bAirtable\b/g, "spreadsheet"],
      [/\ba\s+Sheet\b/g, "a spreadsheet"],
      [/\bthe\s+Sheet\b/g, "the spreadsheet"],
    ],
  },

  knowledge_base: {
    conflicts: ["notion", "confluence", "sharepoint", "obsidian", "desktop_obsidian", "obsidian_memory", "vector_knowledge_base"],
    rewrites: [
      [/\bNotion\s+(page|database|workspace)s?\b/gi, "knowledge base $1s"],
      [/\bConfluence\s+(page|space)s?\b/gi, "knowledge base $1s"],
      [/\bNotion\b/g, "knowledge base"],
      [/\bConfluence\b/g, "knowledge base"],
      [/\bSharePoint\b/g, "knowledge base"],
    ],
  },

  calendar: {
    conflicts: ["google_calendar", "microsoft_calendar"],
    rewrites: [
      [/\bGoogle\s+Calendar\b/g, "calendar"],
      [/\bOutlook\s+Calendar\b/g, "calendar"],
      [/\bMicrosoft\s+Calendar\b/g, "calendar"],
    ],
  },

  project_management: {
    conflicts: ["jira", "linear", "asana", "clickup", "monday"],
    rewrites: [
      [/\b(?:Jira|Linear|Asana|ClickUp|Monday\.com|Monday|Trello)\s+(issue|ticket|task|project|board|card)s?\b/gi, "$1s"],
      [/\bMonday\.com\b/g, "project management"],
      [/\bJira\b/g, "project management"],
      [/\bLinear\b/g, "project management"],
      [/\bAsana\b/g, "project management"],
      [/\bClickUp\b/g, "project management"],
      [/\bTrello\b/g, "project management"],
      [/\bMonday(?!\s*-|\s+through|\s+morning|,)\b/g, "project management"],
    ],
  },

  ticketing: {
    conflicts: [],
    rewrites: [
      [/\bZendesk\b/g, "ticketing"],
      [/\bFreshdesk\b/g, "ticketing"],
      [/\bServiceNow\b/g, "ticketing"],
      [/\bHelpScout\b/g, "ticketing"],
      [/\bIntercom\b/g, "ticketing"],
    ],
  },

  support: {
    conflicts: ["crisp"],
    rewrites: [
      [/\bZendesk\b/g, "support platform"],
      [/\bFreshdesk\b/g, "support platform"],
      [/\bIntercom\b/g, "support platform"],
      [/\bHelpScout\b/g, "support platform"],
    ],
  },

  source_control: {
    conflicts: ["github", "gitlab", "azure_devops"],
    rewrites: [
      [/\bGitHub\b/g, "source control"],
      [/\bGitLab\b/g, "source control"],
      [/\bBitbucket\b/g, "source control"],
      [/\bAzure\s+DevOps\b/g, "source control"],
    ],
  },

  ci_cd: {
    conflicts: ["github_actions", "circleci"],
    rewrites: [
      [/\bGitHub\s+Actions\b/g, "CI/CD"],
      [/\bCircleCI\b/g, "CI/CD"],
      [/\bJenkins\b/g, "CI/CD"],
      [/\bTravis\s*CI\b/g, "CI/CD"],
    ],
  },

  monitoring: {
    conflicts: ["sentry", "betterstack"],
    rewrites: [
      [/\bSentry\b/g, "monitoring"],
      [/\bDatadog\b/g, "monitoring"],
      [/\bBetterStack\b/g, "monitoring"],
      [/\bGrafana\b/g, "monitoring"],
      [/\bNew\s+Relic\b/g, "monitoring"],
      [/\bPagerDuty\b/g, "monitoring"],
    ],
  },

  analytics: {
    conflicts: ["mixpanel", "posthog", "twilio_segment", "humbalytics"],
    rewrites: [
      [/\bGoogle\s+Analytics(?:\s+\((?:GA4|UA)\))?\b/g, "analytics"],
      [/\bMixpanel\b/g, "analytics"],
      [/\bPostHog\b/g, "analytics"],
      [/\bAmplitude\b/g, "analytics"],
      [/\bSegment\b/g, "analytics"],
      [/\bGA4\b/g, "analytics"],
    ],
  },

  social: {
    conflicts: ["linkedin", "reddit", "x_twitter", "youtube_data", "buffer"],
    rewrites: [
      [/\bX\s*\(formerly\s+Twitter\)/g, "social platform"],
      [/\bX\/Twitter\b/g, "social platform"],
      [/\bTwitter\b/g, "social platform"],
      [/\bLinkedIn\b/g, "social platform"],
      [/\bReddit\b/g, "social platform"],
      [/\bYouTube\b/g, "social platform"],
    ],
  },

  cloud: {
    conflicts: ["aws_cloud", "azure_cloud", "gcp_cloud", "vercel", "netlify", "cloudflare", "fly_io", "railway", "digitalocean"],
    rewrites: [
      [/\bAmazon\s+Web\s+Services\b/g, "cloud"],
      [/\bGoogle\s+Cloud(?:\s+Platform)?\b/g, "cloud"],
      [/\bMicrosoft\s+Azure\b/g, "cloud"],
      [/\bAWS\b/g, "cloud"],
      [/\bGCP\b/g, "cloud"],
      [/\bAzure\b/g, "cloud"],
      [/\bVercel\b/g, "cloud"],
      [/\bNetlify\b/g, "cloud"],
    ],
  },

  finance: {
    conflicts: ["stripe", "ramp", "alpha_vantage", "kalshi"],
    rewrites: [
      [/\bQuickBooks\s+Online\b/g, "finance platform"],
      [/\bQuickBooks\b/g, "finance platform"],
      [/\bXero\b/g, "finance platform"],
      [/\bPaddle\b/g, "finance platform"],
      [/\bPlaid\b/g, "finance platform"],
      [/\bChargebee\b/g, "finance platform"],
      [/\bRecurly\b/g, "finance platform"],
    ],
  },

  hr: {
    conflicts: [],
    rewrites: [
      [/\bGreenhouse\s+ATS\b/g, "HR platform"],
      [/\bGreenhouse\b/g, "HR platform"],
      [/\bLever\b/g, "HR platform"],
      [/\bWorkable\b/g, "HR platform"],
      [/\bBambooHR\b/g, "HR platform"],
    ],
  },

  legal: {
    conflicts: [],
    rewrites: [
      [/\bDocuSign\b/g, "legal platform"],
      [/\bHelloSign\b/g, "legal platform"],
      [/\bDropbox\s+Sign\b/g, "legal platform"],
    ],
  },

  security: {
    conflicts: [],
    rewrites: [
      [/\bClerk\b/g, "auth provider"],
      [/\bAuth0\b/g, "auth provider"],
      [/\bOkta\b/g, "auth provider"],
      [/\bSnyk\b/g, "security scanner"],
      [/\bWhoisXML(?:\s+API)?\b/g, "security lookup"],
    ],
  },

  forms: {
    conflicts: ["tally", "formbricks"],
    rewrites: [
      [/\bTypeform\b/g, "form tool"],
      [/\bSurveyMonkey\b/g, "form tool"],
      [/\bJotForm\b/g, "form tool"],
    ],
  },

  cms: {
    conflicts: [],
    rewrites: [
      [/\bWordPress\b/g, "CMS"],
      [/\bGhost\b(?!\s+(?:writer|mode))/g, "CMS"],
      [/\bWebflow\b/g, "CMS"],
      [/\bContentful\b/g, "CMS"],
    ],
  },

  advertising: {
    conflicts: ["google_ads", "meta_ads", "linkedin_ads"],
    rewrites: [
      [/\bGoogle\s+Ads\b/g, "ad platform"],
      [/\bMeta\s+Ads\b/g, "ad platform"],
      [/\bFacebook\s+Ads\b/g, "ad platform"],
      [/\bLinkedIn\s+Ads\b/g, "ad platform"],
    ],
  },

  image_generation: {
    conflicts: ["leonardo_ai"],
    rewrites: [
      [/\bLeonardo(?:\s+AI|\.ai)?\b/g, "image generation AI"],
      [/\bDALL-?E(?:\s*\d+)?\b/g, "image generation AI"],
      [/\bMidjourney\b/g, "image generation AI"],
      [/\bStable\s+Diffusion\b/g, "image generation AI"],
      [/\bOpenAI\s+Images\b/g, "image generation AI"],
    ],
  },

  voice_generation: {
    conflicts: ["elevenlabs"],
    rewrites: [
      [/\bElevenLabs\b/g, "voice generation AI"],
      [/\bOpenAI\s+TTS\b/g, "voice generation AI"],
      [/\bPlay\.ht\b/g, "voice generation AI"],
      [/\bResemble\.ai\b/g, "voice generation AI"],
    ],
  },

  transcription: {
    conflicts: ["deepgram"],
    rewrites: [
      [/\bDeepgram\b/g, "transcription service"],
      [/\bWhisper(?:\s+API)?\b/g, "transcription service"],
      [/\bAssemblyAI\b/g, "transcription service"],
    ],
  },

  vision: {
    conflicts: ["gemini_vision"],
    rewrites: [
      [/\bGemini\s+Vision\b/g, "vision AI"],
      [/\bGPT-4V(?:ision)?\b/g, "vision AI"],
      [/\bClaude\s+Vision\b/g, "vision AI"],
    ],
  },

  web_scraping: {
    conflicts: ["apify", "firecrawl"],
    rewrites: [
      [/\bFirecrawl\b/g, "web scraper"],
      [/\bApify\b/g, "web scraper"],
      [/\bScrapingBee\b/g, "web scraper"],
      [/\bBrightData\b/g, "web scraper"],
    ],
  },

  database: {
    conflicts: ["supabase", "neon", "postgres", "convex", "upstash", "mongodb", "redis", "planetscale", "duckdb", "personas_database"],
    rewrites: [
      [/\bPostgreSQL\b/g, "database"],
      [/\bPostgres\b/g, "database"],
      [/\bMongoDB\b/g, "database"],
      [/\bMySQL\b/g, "database"],
      [/\bSQLite\b(?=\s*(?:\s|,|\.|;|$))/g, "database"],
    ],
  },

  scheduling: {
    conflicts: ["cal_com", "calendly"],
    rewrites: [
      [/\bCal\.com\b/g, "scheduling tool"],
      [/\bCalendly\b/g, "scheduling tool"],
    ],
  },

  time_tracking: {
    conflicts: ["toggl", "clockify", "harvest"],
    rewrites: [
      [/\bToggl\b/g, "time tracking tool"],
      [/\bClockify\b/g, "time tracking tool"],
      [/\bHarvest\b/g, "time tracking tool"],
    ],
  },

  design: {
    conflicts: ["figma", "canva", "penpot"],
    rewrites: [
      [/\bFigma\b/g, "design tool"],
      [/\bCanva\b/g, "design tool"],
      [/\bSketch\b(?=\s*(?:\s|,|\.|;|$))/g, "design tool"],
    ],
  },

  notifications: {
    conflicts: ["novu", "knock", "ntfy"],
    rewrites: [
      [/\bNovu\b/g, "notifications service"],
      [/\bKnock\b/g, "notifications service"],
      [/\bntfy\b/g, "notifications service"],
    ],
  },

  research: {
    conflicts: ["arxiv", "pubmed", "semantic_scholar", "news_api"],
    rewrites: [
      [/\barXiv\b/gi, "research source"],
      [/\bPubMed\b/g, "research source"],
      [/\bSemantic\s+Scholar\b/g, "research source"],
    ],
  },
};

// --- Fields to skip during rewrite ---------------------------------------

const SKIP_KEYS = new Set([
  "id",
  "variable_name",
  "maps_to",
  "event_type",
  "trigger_type",
  "event_subscriptions_key",
  "cron",
  "timezone",
  "key",
  "slug",
  "provider",
  "role",
  "api_base_url",
  "placeholder",
  "sample_input",
  "options", // adoption question options may legitimately name specific tools
  "test_fixtures",
  "icon",
  "color",
]);

// --- Walker --------------------------------------------------------------

function rewriteString(str, rules) {
  let out = str;
  for (const [pattern, replacement] of rules) {
    out = out.replace(pattern, replacement);
  }
  // Collapse artifacts from replacements.
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+([.,;:!?])/g, "$1");
  return out;
}

function walk(node, rules, keyPath = "") {
  if (typeof node === "string") {
    return rewriteString(node, rules);
  }
  if (Array.isArray(node)) {
    return node.map((v) => walk(v, rules, keyPath));
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEYS.has(k)) {
        out[k] = v;
        continue;
      }
      out[k] = walk(v, rules, k);
    }
    return out;
  }
  return node;
}

// --- Template processing -------------------------------------------------

function listTemplates() {
  const files = [];
  function recur(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recur(p);
      else if (e.name.endsWith(".json")) files.push(p);
    }
  }
  recur(path.join(ROOT, "scripts/templates"));
  return files;
}

function processTemplate(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const template = JSON.parse(raw);

  const conns = template.payload?.persona?.connectors ?? [];
  const names = new Set(conns.map((c) => c.name));

  // Collect rules from every abstract slot present.
  const activeRules = [];
  for (const [slot, def] of Object.entries(SLOTS)) {
    if (!names.has(slot)) continue;
    if (def.conflicts.some((b) => names.has(b) || BUILTIN.has(b) && names.has(b))) {
      continue;
    }
    activeRules.push(...def.rewrites);
  }

  if (activeRules.length === 0) return { changed: false, slots: [] };

  const before = JSON.stringify(template);
  const rewritten = walk(template, activeRules);
  const after = JSON.stringify(rewritten);

  if (before === after) return { changed: false, slots: [] };

  const trailing = raw.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(absPath, JSON.stringify(rewritten, null, 2) + trailing);
  return {
    changed: true,
    slots: [...names].filter((n) => SLOTS[n]),
  };
}

// --- Main ----------------------------------------------------------------

function main() {
  const files = listTemplates();
  let changed = 0;
  const perSlot = {};
  for (const f of files) {
    const result = processTemplate(f);
    if (result.changed) {
      changed++;
      for (const s of result.slots) perSlot[s] = (perSlot[s] ?? 0) + 1;
      console.log(`  ${path.relative(ROOT, f)}  [${result.slots.join(", ")}]`);
    }
  }
  console.log(`\nRewrote ${changed}/${files.length} templates.`);
  console.log("Touched-slot histogram:", perSlot);
}

main();
