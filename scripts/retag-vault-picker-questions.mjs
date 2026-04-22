#!/usr/bin/env node
/**
 * One-off migration: retag vault-picker questions from
 * `category: "configuration"` to `category: "credentials"`.
 *
 * The canonical questionnaire category order (see
 * src/features/templates/sub_generated/adoption/questionnaireCategoryOrder.ts)
 * puts `credentials` first, ahead of `configuration`. Hand-authored templates
 * from earlier in the C3 milestone used `configuration` for connector-scope,
 * vault-sourced picker questions, which meant they sorted mid-stream instead
 * of first — leaving the user staring at domain/configuration questions
 * before they'd even been prompted to pick a credential.
 *
 * A question is considered a "vault picker" when:
 *   - scope === "connector"
 *   - dynamic_source.source === "vault"
 *
 * Only templates under scripts/templates/ are modified. No en-US locale
 * variant files are touched — the picker `category` field isn't localised.
 *
 * Run with:
 *   node scripts/retag-vault-picker-questions.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, 'templates');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let totalRetagged = 0;
let filesRetagged = 0;

for (const file of files) {
  // Skip locale variants (e.g. foo.cs.json) — the picker category is not
  // localised and the canonical English template is the source of truth.
  const base = file.split(/[\\/]/).pop();
  if (/\.[a-z]{2}\.json$/.test(base)) continue;

  const raw = readFileSync(file, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    continue; // skip non-JSON
  }

  const questions = data?.adoption_questions;
  if (!Array.isArray(questions)) continue;

  let changed = 0;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const isConnector = q.scope === 'connector';
    const isVaultPicker = q.dynamic_source && q.dynamic_source.source === 'vault';
    if (!isConnector || !isVaultPicker) continue;
    if (q.category === 'configuration') {
      q.category = 'credentials';
      changed++;
    }
  }

  if (changed > 0) {
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    totalRetagged += changed;
    filesRetagged++;
    console.log(`  ${file.replace(ROOT, 'scripts/templates')} — ${changed} question(s)`);
  }
}

console.log(`\nRetagged ${totalRetagged} question(s) in ${filesRetagged} file(s).`);
