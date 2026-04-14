#!/usr/bin/env node
/**
 * Full hand-auditable dump of every adoption question across every template,
 * grouped by the kind of attention it needs during the dynamic-discovery
 * sweep. Used to catch cases a regex-based sweep misses.
 *
 * Categories emitted:
 *   A. has dynamic_source  — Wave 2 style (already upgraded)
 *   B. has option_service_types — Wave 1 vault-aware select (verify alignment
 *      with actual stored service_types, suggest discovery upgrades)
 *   C. type=text, no dynamic_source — candidate for upgrade
 *   D. type=select, no vault_category — pure static select (probably fine)
 *   E. type=boolean — always fine
 *
 * For category B we flag cloud mismatches explicitly because the user hit
 * that case first (Budget Spending Monitor).
 */
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

// Known service_type aliases — credentials can be stored under any of these
// variants depending on how the user added them (catalog vs CLI probe vs
// foraging vs healthcheck discovery). If a template's option_service_types
// only lists the CANONICAL form it silently misses the short forms.
const ALIASES = {
  gcp_cloud: ['gcp_cloud', 'google_cloud'],
  aws_cloud: ['aws_cloud', 'aws'],
  azure_cloud: ['azure_cloud', 'azure'],
};

const buckets = {
  A_dynamic: [],
  B_vault_select: [],
  C_text_candidate: [],
  D_plain_select: [],
  E_boolean: [],
  cloud_mismatches: [],
};

for (const f of files) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  const aqs = j.payload && j.payload.adoption_questions;
  if (!Array.isArray(aqs)) continue;
  const rel = f.replace(/\\/g, '/').replace(/^.*\/templates\//, 'templates/');

  for (const q of aqs) {
    const entry = {
      file: rel,
      id: q.id,
      type: q.type,
      question: (q.question || '').slice(0, 120),
      placeholder: (q.placeholder || '').slice(0, 60),
      vault_category: q.vault_category,
      option_service_types: q.option_service_types,
      dynamic_source: q.dynamic_source,
    };

    if (q.dynamic_source) {
      buckets.A_dynamic.push(entry);
      continue;
    }
    if (q.type === 'boolean') {
      buckets.E_boolean.push(entry);
      continue;
    }
    if (q.type === 'select' && q.option_service_types && q.option_service_types.length) {
      buckets.B_vault_select.push(entry);

      // Cloud alias check: if the question references any canonical cloud
      // name, flag it so we can broaden the list or add alias support.
      for (const [canonical, alternates] of Object.entries(ALIASES)) {
        if (q.option_service_types.includes(canonical)) {
          const missingAlternates = alternates.filter((a) => !q.option_service_types.includes(a));
          if (missingAlternates.length > 0) {
            buckets.cloud_mismatches.push({
              ...entry,
              canonical,
              missing_alternates: missingAlternates,
            });
          }
        }
      }
      continue;
    }
    if (q.type === 'text') {
      buckets.C_text_candidate.push(entry);
      continue;
    }
    if (q.type === 'select') {
      buckets.D_plain_select.push(entry);
      continue;
    }
    buckets.D_plain_select.push(entry);
  }
}

console.log('=== A. dynamic_source (already upgraded) ===');
console.log(`  count: ${buckets.A_dynamic.length}`);
for (const e of buckets.A_dynamic) {
  console.log(`    ${e.file} :: ${e.id} :: ${e.dynamic_source.service_type}.${e.dynamic_source.operation}`);
}

console.log('\n=== B. vault-aware select (option_service_types set) ===');
console.log(`  count: ${buckets.B_vault_select.length}`);
for (const e of buckets.B_vault_select) {
  console.log(`    ${e.file} :: ${e.id} :: vault_category=${e.vault_category} :: types=${JSON.stringify(e.option_service_types)}`);
}

console.log('\n=== CLOUD ALIAS MISMATCHES (auto-detect silently fails) ===');
console.log(`  count: ${buckets.cloud_mismatches.length}`);
for (const e of buckets.cloud_mismatches) {
  console.log(`    ${e.file} :: ${e.id} :: canonical=${e.canonical} :: missing=${JSON.stringify(e.missing_alternates)}`);
}

console.log('\n=== C. type=text (candidates for discovery upgrade) ===');
console.log(`  count: ${buckets.C_text_candidate.length}`);
for (const e of buckets.C_text_candidate) {
  console.log(`    ${e.file} :: ${e.id}`);
  console.log(`       Q: ${e.question}`);
  if (e.placeholder) console.log(`       ph: ${e.placeholder}`);
}

console.log('\n=== D. plain select (no vault_category) ===');
console.log(`  count: ${buckets.D_plain_select.length}`);
console.log(`  (not shown — mostly configuration choices)`);

console.log('\n=== E. boolean ===');
console.log(`  count: ${buckets.E_boolean.length}`);

console.log('\n=== SUMMARY ===');
console.log(`  A dynamic  : ${buckets.A_dynamic.length}`);
console.log(`  B vault    : ${buckets.B_vault_select.length}  (of which cloud-alias mismatched: ${buckets.cloud_mismatches.length})`);
console.log(`  C text     : ${buckets.C_text_candidate.length}  (← candidates for upgrade)`);
console.log(`  D static   : ${buckets.D_plain_select.length}`);
console.log(`  E boolean  : ${buckets.E_boolean.length}`);
