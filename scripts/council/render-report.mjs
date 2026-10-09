#!/usr/bin/env node
// Render a council run directory into one self-contained browser report.
//
//   node scripts/council/render-report.mjs <runDir> [<runDir> ...]
//   node scripts/council/render-report.mjs --all [--db <personas.db>]
//
// Writes `<runDir>/report.html` and nothing else: inline CSS and JS, no
// network, no external fonts. The page leads with the verdict (outcome,
// overall against the bar, coverage, the must-address lines as designed
// claims, a drawn member score header naming the round, run id and head sha),
// then one section per member, then the Director's report.md. It carries NO
// decision control - approve and reject live in the app, bound to the run.
//
// `--all` reads `dev_council_runs.run_dir` from the app database READ-ONLY and
// renders every directory that holds both report.md and result.json; any other
// is skipped with its reason.
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanRunDir, loadRun } from './report/model.mjs';
import { renderPage } from './report/template.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, '..', 'ai-registry');

function usage(code) {
  process.stdout.write(
    'usage: node scripts/council/render-report.mjs <runDir> [...]\n' +
      '       node scripts/council/render-report.mjs --all [--db <personas.db>]\n',
  );
  process.exit(code);
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
      .map((r) => cleanRunDir(r.run_dir));
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

function renderOne(dir) {
  const model = loadRun(dir, { registryRoot: existsSync(REGISTRY) ? REGISTRY : null });
  const html = renderPage(model);
  const out = join(dir, 'report.html');
  writeFileSync(out, html, 'utf8');
  return { out, bytes: Buffer.byteLength(html), model };
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
    try {
      const { out, bytes, model } = renderOne(dir);
      written += 1;
      process.stdout.write(
        `wrote  ${out}  (${(bytes / 1024).toFixed(0)} KB, ${model.outcome}, ${model.members.length} members, ${model.must.length} must-address)\n`,
      );
    } catch (err) {
      failed += 1;
      process.stdout.write(`FAIL   ${dir}  (${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err})\n`);
    }
  }
  process.stdout.write(`\n${written} written, ${skipped} skipped, ${failed} failed, of ${dirs.length} run dirs\n`);
  process.exit(failed ? 1 : 0);
}

await main();
