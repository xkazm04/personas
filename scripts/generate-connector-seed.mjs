#!/usr/bin/env node
/**
 * Generates src-tauri/src/db/builtin_connectors.rs from JSON files in
 * scripts/connectors/builtin/.
 *
 * Run with:
 *   node scripts/generate-connector-seed.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CONNECTORS_DIR = join(ROOT, 'scripts', 'connectors', 'builtin');
const OUTPUT_FILE = join(ROOT, 'src-tauri', 'src', 'db', 'builtin_connectors.rs');

/** Escape a string for use inside a Rust raw string r#"..."# */
function rustRawStr(s) {
  // If the string contains "# we need more pounds, but in practice our JSON won't
  if (s.includes('"#')) {
    throw new Error(`Cannot safely embed string containing '"#' in r#"..."#: ${s.slice(0, 80)}`);
  }
  return `r#"${s}"#`;
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
    pub metadata: Option<&'static str>,
}

pub(crate) const BUILTIN_CONNECTORS: &[BuiltinConnector] = &[
${entries.join(',\n')}
];
`;

writeFileSync(OUTPUT_FILE, output, 'utf-8');
console.log(`Generated ${OUTPUT_FILE} with ${entries.length} connectors`);
