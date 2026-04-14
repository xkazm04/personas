#!/usr/bin/env node
// One-shot script: finds adoption_questions of type=text whose text/placeholder
// matches a discoverable resource pattern. Used during the dynamic-source
// template sweep to identify upgrade candidates. Safe to delete after the
// sweep — keeping it around as a reproducible audit tool.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'scripts', 'templates');
const files = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (f.endsWith('.json')) files.push(p);
  }
}
walk(root);

const KEYS = {
  github_repo: /github.*(repo|repos)|repo.*github|owner\//i,
  slack_channel: /(slack|#).*chan|channel.*slack|slack.*notif|notif.*slack/i,
  vercel_project: /vercel/i,
  netlify_site: /netlify/i,
  cloudflare_zone: /cloudflare|cf.*zone/i,
  asana_workspace_or_project: /asana/i,
  clickup: /clickup/i,
  airtable_base: /airtable.*base|airtable.*table/i,
  neon_project: /neon/i,
  posthog_project: /posthog/i,
  betterstack: /betterstack|uptime/i,
  sentry: /sentry/i,
  generic_repo: /(?:^|\s)repo(?:sitor)?(?:y|ies)?(?:\s|$|,)/i,
  generic_channel: /^#|channel name|alert channel/i,
};

const hits = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const aqs = j.payload && j.payload.adoption_questions;
  if (!aqs || !Array.isArray(aqs)) continue;
  for (const q of aqs) {
    if (q.type !== 'text') continue;
    if (q.dynamic_source) continue;
    const text = `${q.question || ''} ${q.placeholder || ''} ${q.context || ''}`;
    for (const [name, re] of Object.entries(KEYS)) {
      if (re.test(text)) {
        hits.push({
          file: f.replace(/\\/g, '/').replace(/^.*\/templates\//, 'templates/'),
          id: q.id,
          match: name,
          question: (q.question || '').slice(0, 90),
          placeholder: (q.placeholder || '').slice(0, 60),
        });
        break;
      }
    }
  }
}

console.log(JSON.stringify(hits, null, 2));
console.error(`\nTOTAL CANDIDATES: ${hits.length}`);
console.error(`TEMPLATES SCANNED: ${files.length}`);
