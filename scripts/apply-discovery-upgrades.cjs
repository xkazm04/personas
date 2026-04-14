#!/usr/bin/env node
/**
 * One-shot template patcher for the dynamic-source sweep.
 *
 * Walks every template under scripts/templates/, finds adoption_questions
 * of type=text whose text matches a discoverable resource pattern, and
 * rewrites them into type=select with a `dynamic_source` block pointing at
 * the corresponding connector + operation in src-tauri/src/engine/discovery.rs.
 *
 * Idempotent: questions that already have a `dynamic_source` are skipped.
 * Run after adding new entries to the discovery registry to bulk-upgrade
 * matching templates without hand-editing each file.
 *
 * Usage: node scripts/apply-discovery-upgrades.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');

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

// Each rule: detect a discoverable resource via regex on the question text,
// then return the patch object to merge into the question. `multi` is decided
// from a heuristic on the question text (plural form / "channel(s)").
const RULES = [
  {
    name: 'slack_channel',
    test: (text) =>
      /(slack|#).*chan/i.test(text) ||
      /channel.*slack/i.test(text) ||
      /slack.*notif/i.test(text) ||
      /notif.*slack/i.test(text),
    patch: (q) => {
      const text = `${q.question || ''} ${q.placeholder || ''}`;
      const multi = /channel\(s\)|channels|each alert/i.test(text);
      return {
        type: 'select',
        vault_category: 'messaging',
        option_service_types: ['slack'],
        dynamic_source: {
          service_type: 'slack',
          operation: 'list_channels',
          ...(multi ? { multi: true } : {}),
        },
      };
    },
  },
  {
    name: 'github_repo',
    test: (text) =>
      /github.*(repo|repos|repositor)/i.test(text) ||
      /(repo|repos|repositor).*github/i.test(text) ||
      /owner\/repo/i.test(text),
    patch: (q) => {
      const text = `${q.question || ''} ${q.placeholder || ''}`;
      const multi = /repos\b|repositories/i.test(text);
      return {
        type: 'select',
        vault_category: 'devops',
        option_service_types: ['github'],
        dynamic_source: {
          service_type: 'github',
          operation: 'list_repos',
          ...(multi ? { multi: true } : {}),
        },
      };
    },
  },
  {
    name: 'airtable_base',
    test: (text) => /airtable.*base/i.test(text),
    patch: () => ({
      type: 'select',
      vault_category: 'database',
      option_service_types: ['airtable'],
      dynamic_source: {
        service_type: 'airtable',
        operation: 'list_bases',
      },
    }),
  },
];

let totalPatches = 0;
const summary = [];

for (const f of files) {
  let text;
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    continue;
  }
  const aqs = j.payload && j.payload.adoption_questions;
  if (!Array.isArray(aqs)) continue;

  let changed = 0;
  for (const q of aqs) {
    if (q.type !== 'text') continue;
    if (q.dynamic_source) continue;
    const haystack = `${q.question || ''} ${q.placeholder || ''} ${q.context || ''}`;
    for (const rule of RULES) {
      if (!rule.test(haystack)) continue;
      const patch = rule.patch(q);
      // Drop placeholder — no longer applicable to a select.
      delete q.placeholder;
      Object.assign(q, patch);
      summary.push({
        file: f.replace(/\\/g, '/').replace(/^.*\/templates\//, 'templates/'),
        id: q.id,
        rule: rule.name,
      });
      changed++;
      break;
    }
  }

  if (changed > 0 && !DRY) {
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
  }
  totalPatches += changed;
}

console.log(JSON.stringify(summary, null, 2));
console.log(`\nTOTAL PATCHES: ${totalPatches}`);
console.log(DRY ? '(dry run — no files written)' : '(files written)');
