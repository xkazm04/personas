#!/usr/bin/env node
/**
 * Generates src-tauri/src/db/builtin_connectors.rs from JSON files in
 * scripts/connectors/builtin/.
 *
 * Run with:
 *   node scripts/generate-connector-seed.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CONNECTORS_DIR = join(ROOT, 'scripts', 'connectors', 'builtin');
const OUTPUT_FILE = join(ROOT, 'src-tauri', 'src', 'db', 'builtin_connectors.rs');

/** Escape a string for use inside a Rust raw string r##"..."## */
function rustRawStr(s) {
  // Use two pound signs so the raw string terminates on "## -- lets us safely
  // embed payloads that contain "# (e.g. JSON fragments with channel names or
  // CSS colors). If a payload ever contains "## we need more pounds still.
  if (s.includes('"##')) {
    throw new Error(`Cannot safely embed string containing '"##' in r##"..."##: ${s.slice(0, 80)}`);
  }
  return `r##"${s}"##`;
}

const files = readdirSync(CONNECTORS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const entries = [];

for (const file of files) {
  const raw = readFileSync(join(CONNECTORS_DIR, file), 'utf-8');
  const c = JSON.parse(raw);

  // Stringify sub-objects the same way the Rust code expects them
  const fields = JSON.stringify(c.fields ?? []);
  const healthcheck = c.healthcheck_config ? JSON.stringify(c.healthcheck_config) : null;
  const metadata = c.metadata ? JSON.stringify(c.metadata) : null;
  const services = JSON.stringify(c.services ?? []);
  const events = JSON.stringify(c.events ?? []);

  entries.push(
    `        BuiltinConnector {
            id: ${rustRawStr(c.id)},
            name: ${rustRawStr(c.name)},
            label: ${rustRawStr(c.label)},
            color: ${rustRawStr(c.color)},
            icon_url: ${rustRawStr(c.icon_url ?? '')},
            category: ${rustRawStr(c.category ?? 'general')},
            fields: ${rustRawStr(fields)},
            healthcheck_config: ${healthcheck ? `Some(${rustRawStr(healthcheck)})` : 'None'},
            services: ${rustRawStr(services)},
            events: ${rustRawStr(events)},
            metadata: ${metadata ? `Some(${rustRawStr(metadata)})` : 'None'},
        }`,
  );
}

const output = `// Auto-generated from scripts/connectors/builtin/*.json
// DO NOT EDIT MANUALLY. Regenerate with: node scripts/generate-connector-seed.mjs

pub(crate) struct BuiltinConnector {
    pub id: &'static str,
    pub name: &'static str,
    pub label: &'static str,
    pub color: &'static str,
    pub icon_url: &'static str,
    pub category: &'static str,
    pub fields: &'static str,
    pub healthcheck_config: Option<&'static str>,
    pub services: &'static str,
    pub events: &'static str,
    pub metadata: Option<&'static str>,
}

pub(crate) const BUILTIN_CONNECTORS: &[BuiltinConnector] = &[
${entries.join(',\n')}
];
`;

// Skip write if content is identical to avoid unnecessary Rust rebuilds when
// this script runs on every `predev` / `prebuild`.
const existing = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf-8') : null;
if (existing === output) {
  console.log(`Connector seed up to date (${entries.length} connectors, no change)`);
} else {
  writeFileSync(OUTPUT_FILE, output, 'utf-8');
  console.log(`Generated ${OUTPUT_FILE} with ${entries.length} connectors`);
}
