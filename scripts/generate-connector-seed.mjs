#!/usr/bin/env node
/**
 * Generates src-tauri/db/src/builtin_connectors.rs from JSON files in
 * scripts/connectors/builtin/.
 *
 * Run with:
 *   node scripts/generate-connector-seed.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CONNECTORS_DIR = join(ROOT, 'scripts', 'connectors', 'builtin');
const OUTPUT_FILE = join(ROOT, 'src-tauri', 'db', 'src', 'builtin_connectors.rs');

/** Escape a string for use inside a Rust raw string r##"..."## */

/**
 * Run rustfmt over a generated .rs file, in place.
 *
 * WHY. This generator emits Rust by string concatenation, and its output was
 * committed unformatted for as long as the repo had no formatting policy. The
 * 2026-08-20 workspace `cargo fmt` reformatted the committed copy — correctly,
 * it is a tracked .rs file and a `rust-fmt` CI job now enforces it — but the
 * generator kept emitting the raw shape. Every `npm run dev` therefore rewrote
 * the file into a state that fails the format gate, and the only thing standing
 * between that and a red CI was a human noticing a dirty tree and reverting it.
 *
 * Formatting here rather than exempting generated files from the gate: the
 * output is source that people read and diff, and "generated" is not a reason
 * for it to look different from everything around it.
 *
 * Best-effort by design. If rustfmt is unavailable the generated file is still
 * correct Rust and the build proceeds; the format gate will catch the shape
 * later, which is a louder and better-placed failure than aborting codegen.
 */
function rustfmtInPlace(file) {
  try {
    execFileSync('rustfmt', ['--edition', '2021', file], { stdio: 'pipe' });
  } catch (err) {
    console.warn(
      `[${file}] rustfmt did not run (${err.code ?? err.message}); ` +
        'the file is valid Rust but may not match the format gate.',
    );
  }
}

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
  const resources = Array.isArray(c.resources) && c.resources.length > 0
    ? JSON.stringify(c.resources)
    : null;

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
            resources: ${resources ? `Some(${rustRawStr(resources)})` : 'None'},
        }`,
  );
}

const output = `// Auto-generated from scripts/connectors/builtin/*.json
// DO NOT EDIT MANUALLY. Regenerate with: node scripts/generate-connector-seed.mjs

pub struct BuiltinConnector {
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
    /// JSON array of ResourceSpec objects (see docs/resource-scoping-spec.md).
    /// None when the connector has no user-pickable sub-resources.
    pub resources: Option<&'static str>,
}

pub const BUILTIN_CONNECTORS: &[BuiltinConnector] = &[
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
  rustfmtInPlace(OUTPUT_FILE);
  console.log(`Generated ${OUTPUT_FILE} with ${entries.length} connectors`);
}
