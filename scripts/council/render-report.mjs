#!/usr/bin/env node
// Re-render council run directories into their browser report - a thin wrapper.
//
//   node scripts/council/render-report.mjs <runDir> [<runDir> ...]
//   node scripts/council/render-report.mjs --all [--db <personas.db>]
//
// The renderer lives in the /council skill, because the step that writes report.md
// (phase 5) is the one place that always runs Node with the run directory in hand; an
// installed app carries no scripts. This wrapper only finds the registry checkout and runs
//
//   node <registry>/skills/council/scripts/council.mjs report --run-dir <dir>
//
// once per directory. Registry location, in order: `$AI_REGISTRY_DIR` (unset and empty
// are the same "no override"), `.ai/manifest.yaml` `registry.local`, then `../ai-registry`.
//
// `--all` reads `dev_council_runs.run_dir` from the app database READ-ONLY and renders
// every directory that holds both report.md and result.json; any other is skipped with
// its reason.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function usage(code) {
  process.stdout.write(
    'usage: node scripts/council/render-report.mjs <runDir> [...]\n' +
      '       node scripts/council/render-report.mjs --all [--db <personas.db>]\n',
  );
  process.exit(code);
}

/** `registry.local` from .ai/manifest.yaml, or null. A two-key read, not a YAML parser. */
function manifestRegistryLocal() {
  const file = join(ROOT, '.ai', 'manifest.yaml');
  if (!existsSync(file)) return null;
  let inRegistry = false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line)) inRegistry = /^registry:\s*(?:#.*)?$/.test(line);
    else if (inRegistry) {
      const m = /^\s+local:\s*(.+?)\s*(?:#.*)?$/.exec(line);
      if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2') || null;
    }
  }
  return null;
}

function registryRoot() {
  // An unset and an empty AI_REGISTRY_DIR are the same thing: no override.
  const fromEnv = process.env.AI_REGISTRY_DIR || null;
  const raw = fromEnv || manifestRegistryLocal() || '../ai-registry';
  return isAbsolute(raw) ? raw : resolve(ROOT, raw);
}

/** Strip the Win32 extended-length prefix the app stores (`\\?\C:\...`, `\\?\UNC\host\...`). */
function cleanRunDir(p) {
  let s = String(p ?? '').trim();
  if (s.startsWith('\\\\?\\UNC\\')) s = '\\\\' + s.slice(8);
  else if (s.startsWith('\\\\?\\')) s = s.slice(4);
  return s;
}

// node:sqlite is imported only for --all, so rendering one dir prints no
// experimental-module warning.
async function dbRunDirs(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT run_dir FROM dev_council_runs WHERE run_dir IS NOT NULL ORDER BY started_at')
      .all()
      .map((r) => resolve(cleanRunDir(r.run_dir)));
  } finally {
    db.close();
  }
}

/** Why a directory cannot be rendered, or null when it can. */
function skipReason(dir) {
  if (!existsSync(dir)) return 'directory does not exist';
  if (!statSync(dir).isDirectory()) return 'not a directory';
  const missing = ['report.md', 'result.json'].filter((f) => !existsSync(join(dir, f)));
  return missing.length ? `missing ${missing.join(' and ')}` : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) usage(args.length ? 0 : 1);
  const all = args.includes('--all');
  const dbIdx = args.indexOf('--db');
  // An unset and an empty APPDATA are the same thing here: no default location.
  const appData = process.env.APPDATA;
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : appData ? join(appData, 'com.personas.desktop', 'personas.db') : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && !(dbIdx >= 0 && i === dbIdx + 1));

  const registry = registryRoot();
  const council = join(registry, 'skills', 'council', 'scripts', 'council.mjs');
  if (!existsSync(council)) {
    process.stderr.write(`no council skill at ${council}; set AI_REGISTRY_DIR or registry.local in .ai/manifest.yaml\n`);
    process.exit(2);
  }

  let dirs = positional.map((p) => resolve(cleanRunDir(p)));
  if (all) {
    if (!dbPath || !existsSync(dbPath)) {
      process.stderr.write(dbPath ? `no app database at ${dbPath}\n` : 'APPDATA is not set; pass --db <personas.db>\n');
      process.exit(2);
    }
    dirs = [...new Set([...dirs, ...(await dbRunDirs(dbPath))])];
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const dir of dirs) {
    const why = skipReason(dir);
    if (why) {
      skipped += 1;
      process.stdout.write(`skip   ${dir}  (${why})\n`);
      continue;
    }
    const r = spawnSync(process.execPath, [council, 'report', '--run-dir', dir], { encoding: 'utf8' });
    let out = null;
    try {
      out = r.status === 0 ? JSON.parse(r.stdout).written : null;
    } catch {
      out = null; // a malformed answer is reported as a failure below, with stderr
    }
    if (out) {
      written += 1;
      process.stdout.write(`wrote  ${out}  (${(statSync(out).size / 1024).toFixed(0)} KB)\n`);
    } else {
      failed += 1;
      process.stdout.write(`FAIL   ${dir}  (exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]})\n`);
    }
  }
  process.stdout.write(`\n${written} written, ${skipped} skipped, ${failed} failed, of ${dirs.length} run dirs\n`);
  process.exit(failed ? 1 : 0);
}

await main();
