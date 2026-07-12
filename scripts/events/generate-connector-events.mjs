#!/usr/bin/env node
/**
 * Curated connector-API-change events — distribution-stage generator.
 *
 * Three responsibilities:
 *   1. Emit the WATCH LIST  scripts/events/connector-docs.manifest.json from the
 *      connectors in scripts/connectors/builtin/*.json that expose a public
 *      docs_url. Copy this file into pumper/catalog/connector-docs.json so the
 *      `connector-api-watch` pumper app knows what to scrape.
 *   2. Optionally INGEST a pumper changes.json (--changes <path>) and merge its
 *      detected changes as new firings into the durable ledger
 *      scripts/events/connector-events.ledger.json (source of truth; accumulates
 *      across releases; dev-reviewed + committed).
 *   3. CODE-GENERATE src-tauri/src/db/builtin_shared_events.rs from the current
 *      connector list (catalog: one feed per connector) + the ledger (firings).
 *
 * Run:
 *   node scripts/events/generate-connector-events.mjs              # manifest + regen .rs from ledger
 *   node scripts/events/generate-connector-events.mjs --changes path/to/changes.json
 *
 * The .rs output is baked into the release binary and seeded on startup by
 * db/mod.rs::seed_builtin_shared_events. See docs/plans/curated-connector-events.md.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CONNECTORS_DIR = join(ROOT, 'scripts', 'connectors', 'builtin');
const EVENTS_DIR = join(ROOT, 'scripts', 'events');
const MANIFEST_FILE = join(EVENTS_DIR, 'connector-docs.manifest.json');
const LEDGER_FILE = join(EVENTS_DIR, 'connector-events.ledger.json');
const OUTPUT_RS = join(ROOT, 'src-tauri', 'src', 'db', 'builtin_shared_events.rs');

const CATEGORY = 'connector_updates';
const PUBLISHER = 'Personas';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const changesPath = argVal('--changes');
const releaseVersion =
  argVal('--release') ||
  (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || 'unreleased';
    } catch {
      return 'unreleased';
    }
  })();

// ---------------------------------------------------------------------------
// Rust raw-string escaping (mirrors scripts/generate-connector-seed.mjs)
// ---------------------------------------------------------------------------
function rustRawStr(s) {
  if (s == null) return 'None';
  const str = String(s);
  if (str.includes('"##')) {
    throw new Error(`Cannot embed string containing '"##' in r##"..."##: ${str.slice(0, 80)}`);
  }
  return `r##"${str}"##`;
}
function rustOptStr(s) {
  return s == null ? 'None' : `Some(${rustRawStr(s)})`;
}

// ---------------------------------------------------------------------------
// 1. Build the watch list (catalog source) from connectors
// ---------------------------------------------------------------------------
function isPublicDocsUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function loadConnectors() {
  const files = readdirSync(CONNECTORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out = [];
  for (const file of files) {
    let c;
    try {
      c = JSON.parse(readFileSync(join(CONNECTORS_DIR, file), 'utf-8'));
    } catch (e) {
      console.warn(`  ! skipping ${file}: ${e.message}`);
      continue;
    }
    const meta = c.metadata || {};
    const docsUrl = meta.docs_url;
    if (!isPublicDocsUrl(docsUrl)) continue;
    // name is the connector's stable machine name (may contain hyphens/underscores)
    const slug = `connector.${c.name}.api`;
    out.push({
      connector: c.name,
      label: c.label || c.name,
      slug,
      catalogId: `shared-connector-${c.name}`,
      docsUrl,
      icon: c.icon_url || null,
      color: c.color || null,
      summary: meta.summary || null,
    });
  }
  return out;
}

function buildManifest(connectors) {
  return {
    version: 1,
    note:
      'Watch list for the pumper connector-api-watch app. Generated from ' +
      'scripts/connectors/builtin/*.json (connectors with a public docs_url). ' +
      'Copy into pumper/catalog/connector-docs.json. Do not hand-edit; regenerate ' +
      'with node scripts/events/generate-connector-events.mjs.',
    connectors: connectors.map((c) => ({
      slug: c.connector,
      label: c.label,
      docs_url: c.docsUrl,
      icon: c.icon,
      color: c.color,
    })),
  };
}

function catalogSamplePayload(c) {
  return JSON.stringify({
    connector: c.connector,
    label: c.label,
    docs_url: c.docsUrl,
    detected_at: '2026-01-01T00:00:00Z',
    summary: `Example: ${c.label} added a new endpoint and deprecated one query parameter.`,
    tags: ['new_endpoint', 'deprecation'],
    severity: 'minor',
    release_version: '0.0.0',
  });
}

const FIRING_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    connector: { type: 'string' },
    label: { type: 'string' },
    docs_url: { type: 'string' },
    detected_at: { type: 'string', format: 'date-time' },
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['patch', 'minor', 'major', 'breaking'] },
    release_version: { type: 'string' },
  },
  required: ['connector', 'summary', 'detected_at'],
});

// ---------------------------------------------------------------------------
// 2. Ledger (durable firings source of truth)
// ---------------------------------------------------------------------------
function loadLedger() {
  if (existsSync(LEDGER_FILE)) {
    try {
      const l = JSON.parse(readFileSync(LEDGER_FILE, 'utf-8'));
      l.firings = Array.isArray(l.firings) ? l.firings : [];
      return l;
    } catch (e) {
      throw new Error(`Corrupt ledger ${LEDGER_FILE}: ${e.message}`);
    }
  }
  return { version: 1, firings: [] };
}

function firingId(change) {
  // Stable id so re-ingesting the same changes.json is idempotent.
  const day = (change.detected_at || '').slice(0, 10);
  const basis = `${change.connector}|${day}|${change.summary || ''}`;
  return `caf-${change.connector}-${day}-${createHash('sha1').update(basis).digest('hex').slice(0, 8)}`;
}

function ingestChanges(ledger, connectors) {
  if (!changesPath) return { added: 0 };
  if (!existsSync(changesPath)) throw new Error(`--changes file not found: ${changesPath}`);
  const raw = JSON.parse(readFileSync(changesPath, 'utf-8'));
  const changes = Array.isArray(raw) ? raw : Array.isArray(raw.changes) ? raw.changes : [];
  const bySlug = new Map(connectors.map((c) => [c.connector, c]));
  const existingIds = new Set(ledger.firings.map((f) => f.id));
  let maxSeq = ledger.firings.reduce((m, f) => Math.max(m, f.seq || 0), 0);
  let added = 0;
  for (const ch of changes) {
    const conn = bySlug.get(ch.connector);
    if (!conn) {
      console.warn(`  ! change for unknown/non-public connector '${ch.connector}' — skipped`);
      continue;
    }
    const id = firingId(ch);
    if (existingIds.has(id)) continue;
    existingIds.add(id);
    maxSeq += 1;
    const detectedAt = ch.detected_at || new Date().toISOString();
    ledger.firings.push({
      seq: maxSeq,
      id,
      slug: conn.slug,
      connector: conn.connector,
      title: `${conn.label} API updated`,
      fired_at: detectedAt,
      release_version: releaseVersion,
      payload: {
        connector: conn.connector,
        label: conn.label,
        docs_url: conn.docsUrl,
        detected_at: detectedAt,
        summary: ch.summary || 'API documentation changed.',
        tags: Array.isArray(ch.tags) ? ch.tags : [],
        severity: ch.severity || 'minor',
        release_version: releaseVersion,
      },
    });
    added += 1;
  }
  // Keep firings ordered by seq for a stable, reviewable diff.
  ledger.firings.sort((a, b) => a.seq - b.seq);
  return { added };
}

// ---------------------------------------------------------------------------
// 3. Code-generate builtin_shared_events.rs
// ---------------------------------------------------------------------------
function generateRs(connectors, ledger) {
  const lines = [];
  lines.push('// Auto-generated from scripts/connectors/builtin/*.json (catalog) and');
  lines.push('// scripts/events/connector-events.ledger.json (firings).');
  lines.push('// DO NOT EDIT MANUALLY. Regenerate with:');
  lines.push('//   node scripts/events/generate-connector-events.mjs');
  lines.push('//');
  lines.push('// Baked, local-first curated events: one subscribable marketplace feed per');
  lines.push('// connector with public API docs, plus the detected API-change firings that');
  lines.push('// ship with this release. See docs/plans/curated-connector-events.md.');
  lines.push('');
  lines.push('pub(crate) struct BuiltinSharedEvent {');
  lines.push('    pub id: &\'static str,');
  lines.push('    pub slug: &\'static str,');
  lines.push('    pub name: &\'static str,');
  lines.push('    pub description: &\'static str,');
  lines.push('    pub category: &\'static str,');
  lines.push('    pub publisher: &\'static str,');
  lines.push('    pub icon: Option<&\'static str>,');
  lines.push('    pub color: Option<&\'static str>,');
  lines.push('    pub sample_payload: Option<&\'static str>,');
  lines.push('    pub event_schema: Option<&\'static str>,');
  lines.push('}');
  lines.push('');
  lines.push('pub(crate) struct BuiltinSharedEventFiring {');
  lines.push('    pub id: &\'static str,');
  lines.push('    pub slug: &\'static str,');
  lines.push('    /// Monotonic ledger order; the subscription cursor compares against this.');
  lines.push('    pub seq: i64,');
  lines.push('    pub title: &\'static str,');
  lines.push('    pub fired_at: &\'static str,');
  lines.push('    /// JSON payload delivered on the bus as the `shared:<slug>` event.');
  lines.push('    pub payload: &\'static str,');
  lines.push('    pub release_version: &\'static str,');
  lines.push('}');
  lines.push('');

  // Catalog
  lines.push('pub(crate) const BUILTIN_SHARED_EVENTS: &[BuiltinSharedEvent] = &[');
  for (const c of connectors) {
    const name = `${c.label} API updates`;
    const description =
      `Curated updates to the ${c.label} API — new or deprecated endpoints, ` +
      `auth changes, and parameter changes detected from the public API docs. ` +
      `Subscribe to react when ${c.label} changes.`;
    lines.push('    BuiltinSharedEvent {');
    lines.push(`        id: ${rustRawStr(c.catalogId)},`);
    lines.push(`        slug: ${rustRawStr(c.slug)},`);
    lines.push(`        name: ${rustRawStr(name)},`);
    lines.push(`        description: ${rustRawStr(description)},`);
    lines.push(`        category: ${rustRawStr(CATEGORY)},`);
    lines.push(`        publisher: ${rustRawStr(PUBLISHER)},`);
    lines.push(`        icon: ${rustOptStr(c.icon)},`);
    lines.push(`        color: ${rustOptStr(c.color)},`);
    lines.push(`        sample_payload: ${rustOptStr(catalogSamplePayload(c))},`);
    lines.push(`        event_schema: ${rustOptStr(FIRING_SCHEMA)},`);
    lines.push('    },');
  }
  lines.push('];');
  lines.push('');

  // Firings
  lines.push('pub(crate) const BUILTIN_SHARED_EVENT_FIRINGS: &[BuiltinSharedEventFiring] = &[');
  for (const f of ledger.firings) {
    lines.push('    BuiltinSharedEventFiring {');
    lines.push(`        id: ${rustRawStr(f.id)},`);
    lines.push(`        slug: ${rustRawStr(f.slug)},`);
    lines.push(`        seq: ${Number(f.seq)},`);
    lines.push(`        title: ${rustRawStr(f.title)},`);
    lines.push(`        fired_at: ${rustRawStr(f.fired_at)},`);
    lines.push(`        payload: ${rustRawStr(JSON.stringify(f.payload))},`);
    lines.push(`        release_version: ${rustRawStr(f.release_version || 'unreleased')},`);
    lines.push('    },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
function main() {
  if (!existsSync(EVENTS_DIR)) mkdirSync(EVENTS_DIR, { recursive: true });

  const connectors = loadConnectors();
  console.log(`Connectors with public docs_url: ${connectors.length}`);

  // 1. manifest
  writeFileSync(MANIFEST_FILE, JSON.stringify(buildManifest(connectors), null, 2) + '\n');
  console.log(`Wrote ${MANIFEST_FILE}`);

  // 2. ledger ingest (optional)
  const ledger = loadLedger();
  const { added } = ingestChanges(ledger, connectors);
  if (changesPath) {
    writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`Ingested ${added} new firing(s) from ${changesPath} → ${LEDGER_FILE}`);
  } else if (!existsSync(LEDGER_FILE)) {
    writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`Initialized empty ledger ${LEDGER_FILE}`);
  }

  // 3. codegen
  writeFileSync(OUTPUT_RS, generateRs(connectors, ledger));
  console.log(
    `Wrote ${OUTPUT_RS} — ${connectors.length} catalog feed(s), ${ledger.firings.length} firing(s)`,
  );
}

main();
