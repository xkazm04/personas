#!/usr/bin/env node
/**
 * CI guard: fail the build if two canonical template JSON files share an `id`.
 *
 * Silent last-wins dedupe in the Vite glob loader was picking different
 * winners on Linux vs Windows, so this script runs before merge to turn the
 * copy-paste-without-renaming mistake into a clear build error.
 *
 * Usage: `node scripts/check-template-ids.mjs`
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(ROOT, 'scripts', 'templates');

// Sibling-overlay suffix pattern — must stay in sync with
// src/lib/personas/templates/templateOverlays.ts::OVERLAY_SUFFIX_RE.
const OVERLAY_SUFFIX_RE = /\.(ar|bn|cs|de|es|fr|hi|id|ja|ko|ru|vi|zh)\.json$/;

/** Recursively collect every *.json under TEMPLATES_DIR, excluding overlays and debug dirs. */
async function collectTemplateFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_')) continue; // debug / scratch dirs
      files.push(...(await collectTemplateFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.json') && !OVERLAY_SUFFIX_RE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  let files;
  try {
    files = await collectTemplateFiles(TEMPLATES_DIR);
  } catch (err) {
    console.error(`check-template-ids: could not read ${TEMPLATES_DIR}: ${err.message}`);
    process.exit(2);
  }

  const byId = new Map(); // id -> [{ relPath, isPublished }]
  for (const file of files) {
    const relPath = path.relative(TEMPLATES_DIR, file).replace(/\\/g, '/');
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      console.error(`check-template-ids: could not parse ${relPath}: ${err.message}`);
      process.exit(2);
    }
    if (typeof parsed?.id !== 'string') continue; // upstream loader also skips these
    const entries = byId.get(parsed.id) ?? [];
    entries.push({ relPath, isPublished: parsed.is_published !== false });
    byId.set(parsed.id, entries);
  }

  // Only treat collisions between published templates as fatal — unpublished
  // stubs are legitimately allowed to share an id with their published version.
  const collisions = [];
  for (const [id, entries] of byId) {
    const published = entries.filter((e) => e.isPublished);
    if (published.length > 1) {
      collisions.push({ id, paths: published.map((e) => e.relPath) });
    }
  }

  if (collisions.length === 0) {
    console.log(`check-template-ids: OK (${byId.size} unique ids across ${files.length} files)`);
    return;
  }

  console.error('check-template-ids: duplicate template ids detected:');
  for (const { id, paths } of collisions) {
    console.error(`  "${id}":`);
    for (const p of paths) console.error(`    - ${p}`);
  }
  console.error(
    '\nEvery canonical template must have a unique `id`. Rename one of the ' +
      'colliding files, or set `is_published: false` on the duplicate.',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`check-template-ids: unexpected error: ${err.stack ?? err.message}`);
  process.exit(2);
});
