#!/usr/bin/env node
/**
 * Seed the Supabase connector_catalog table from local builtin JSON files.
 *
 * Usage:
 *   node scripts/connectors/seed-supabase-catalog.mjs
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 * (or SUPABASE_ANON_KEY if RLS allows inserts for anon).
 *
 * Uses the Supabase REST API directly — no SDK dependency needed.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(__dirname, 'builtin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY');
  process.exit(1);
}

/** Extract the web-safe fields we want in Supabase from a connector JSON */
function toRow(connector) {
  const meta = connector.metadata || {};
  return {
    id: connector.id,
    name: connector.name,
    label: connector.label,
    summary: meta.summary || null,
    category: connector.category,
    auth_type: meta.auth_type || null,
    auth_type_label: meta.auth_type_label || null,
    pricing_tier: meta.pricing_tier || 'free',
    icon_url: connector.icon_url || null,
    color: connector.color || null,
    docs_url: meta.docs_url || null,
    is_active: true,
  };
}

async function main() {
  // Read all JSON files from the builtin directory
  const files = (await readdir(BUILTIN_DIR)).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} connector definitions`);

  const rows = [];
  for (const file of files) {
    const raw = await readFile(join(BUILTIN_DIR, file), 'utf-8');
    const connector = JSON.parse(raw);
    rows.push(toRow(connector));
  }

  // Upsert all rows via Supabase REST API (PostgREST)
  // Using Prefer: resolution=merge-duplicates for upsert behavior
  const url = `${SUPABASE_URL}/rest/v1/connector_catalog`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Supabase upsert failed (${res.status}): ${body}`);
    process.exit(1);
  }

  console.log(`Upserted ${rows.length} connectors to connector_catalog`);

  // Print summary table
  console.log('\nConnector catalog:');
  console.log('─'.repeat(80));
  console.log(
    'Name'.padEnd(20),
    'Category'.padEnd(15),
    'Auth'.padEnd(12),
    'Tier'.padEnd(10),
    'Label',
  );
  console.log('─'.repeat(80));
  for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(
      r.name.padEnd(20),
      r.category.padEnd(15),
      (r.auth_type || '-').padEnd(12),
      r.pricing_tier.padEnd(10),
      r.label,
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
