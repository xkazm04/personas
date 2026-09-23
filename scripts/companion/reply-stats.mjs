#!/usr/bin/env node
/**
 * Athena reply-shape stats — WP4 (spark athena-layered-voice), "Measurement".
 *
 * Walks the local companion brain's episode store and reports AGGREGATE
 * numbers about assistant replies (word/char length, bare-id leakage,
 * ref-link usage) — NEVER the reply text itself. This is the "did layer one
 * actually change anything" instrument: run it once before WP1/WP2 ship to
 * capture the before number, run it again after with `--since <the day they
 * landed>` to get the after number, and diff by hand (this script does not
 * do the diff itself — the doc's "Measurement" section explains how).
 *
 * Uses the SAME counters as the bench harness (scripts/test/lib/reply-shape.mjs)
 * so a number from this script and a number from
 * `node scripts/test/athena-model-bench.mjs --report` are computed
 * identically.
 *
 * Usage:
 *   npm run athena:reply-stats
 *   node scripts/companion/reply-stats.mjs [--since 2026-09-01] [--brain-dir <path>]
 *
 * Env:
 *   PERSONAS_BRAIN_DIR   override the episode store root (default
 *                        ~/.personas/companion-brain/episodes)
 *   PERSONAS_USER_DB     override the user db path used for the
 *                        reports-per-day figure (default
 *                        %APPDATA%/com.personas.desktop/personas_data.db on
 *                        Windows, matching scripts/test/db.mjs)
 *
 * Never prints episode/message text — only counts and derived numbers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { replyShape, median, percentile } from '../test/lib/reply-shape.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// better-sqlite3 is CJS-only; this is the standard lazy-require-from-ESM
// shape (scripts/test/db.mjs uses a static `import Database from
// 'better-sqlite3'` instead, but that script always runs from a context
// where the package resolves — this one may run standalone via
// `node scripts/companion/reply-stats.mjs`, so resolve it lazily and
// degrade to "n/a" instead of a hard crash if it's ever unavailable).
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const opt = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BRAIN_DIR =
  process.env.PERSONAS_BRAIN_DIR ??
  opt('--brain-dir') ??
  path.join(os.homedir(), '.personas', 'companion-brain', 'episodes');

const sinceArg = opt('--since');
const since = sinceArg ? new Date(sinceArg) : null;
if (sinceArg && Number.isNaN(since?.getTime())) {
  console.error(`--since ${sinceArg}: not a parseable date (expected e.g. 2026-09-01)`);
  process.exit(1);
}

// ── walk episodes, parse frontmatter only (never log body text) ────────────
/** Minimal frontmatter reader for `---\nkey: "value"\n---\n\nbody`. Returns
 *  { role, created } or null if the file doesn't look like an episode. We
 *  read the whole file (bodies can be long) but only ever touch the two
 *  frontmatter fields and, for shape counting, the body's LENGTH/COUNTS —
 *  never print the body itself. */
function readEpisode(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return null;
  const fm = raw.slice(3, end);
  const roleM = /^role:\s*(\S+)\s*$/m.exec(fm);
  const createdM = /^created:\s*"?([^"\n]+?)"?\s*$/m.exec(fm);
  if (!roleM || !createdM) return null;
  const body = raw.slice(end + 4).replace(/^---\s*\n/, '').trim();
  return { role: roleM[1], created: createdM[1], body };
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch (e) {
    console.error(`cannot read brain dir ${dir}: ${e.message}`);
    return;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const full = path.join(e.parentPath ?? e.path ?? dir, e.name);
    out.push(full);
  }
}

const files = [];
walk(BRAIN_DIR, files);

const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);
const fmt = (n) => (n == null ? 'n/a' : String(n));

function run() {
  const words = [];
  const chars = [];
  let total = 0;
  let withBareId = 0;
  let withThreeBareIds = 0;
  let withBareIdStrict = 0; // comparison only — see replyShape()'s doc comment
  let withRefLink = 0;
  let earliest = null;
  let latest = null;

  for (const f of files) {
    const ep = readEpisode(f);
    if (!ep || ep.role !== 'assistant') continue;
    const created = new Date(ep.created);
    if (Number.isNaN(created.getTime())) continue;
    if (since && created < since) continue;
    if (!ep.body) continue; // empty assistant turn (tool-only, etc.) — not a reply

    // `bareIds` is the PRIMARY contract count as of the 2026-09-23 Director
    // amendment: an id inside inline code counts (only a fenced code block
    // or a ref-link handle is exempt) — see reply-shape.mjs's countBareIds
    // doc comment. `bareIdsStrict` (all code spans exempt) is carried
    // alongside for a one-line "how much of this was backtick-wrapped"
    // comparison; it does not feed any of the primary percentages below.
    const shape = replyShape(ep.body);
    total++;
    words.push(shape.words);
    chars.push(shape.chars);
    if (shape.bareIds >= 1) withBareId++;
    if (shape.bareIds >= 3) withThreeBareIds++;
    if (shape.bareIdsStrict >= 1) withBareIdStrict++;
    if (shape.refLinkCount >= 1) withRefLink++;
    if (!earliest || created < earliest) earliest = created;
    if (!latest || created > latest) latest = created;
  }

  return { total, words, chars, withBareId, withThreeBareIds, withBareIdStrict, withRefLink, earliest, latest };
}

// ── reports/day — read-only over the user db, never fails the run ─────────
function reportsPerDay(earliest, latest) {
  const dbPath =
    process.env.PERSONAS_USER_DB ??
    path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'com.personas.desktop', 'personas_data.db');
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return { value: null, reason: 'better-sqlite3 not resolvable' };
  }
  if (!fs.existsSync(dbPath)) return { value: null, reason: `db not found at ${dbPath}` };
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companion_chat_card'")
      .get();
    if (!hasTable) return { value: null, reason: 'companion_chat_card table not present (pre-WP2 db)' };
    const row = since
      ? db.prepare("SELECT COUNT(*) n FROM companion_chat_card WHERE kind = 'report' AND created_at >= ?").get(since.toISOString())
      : db.prepare("SELECT COUNT(*) n FROM companion_chat_card WHERE kind = 'report'").get();
    const days = Math.max(
      1,
      Math.ceil(((latest ?? new Date()) - (since ?? earliest ?? latest ?? new Date())) / 86_400_000) || 1,
    );
    return { value: +(row.n / days).toFixed(2), reason: null, count: row.n, days };
  } catch (e) {
    return { value: null, reason: `read failed: ${e.message}` };
  } finally {
    db?.close();
  }
}

async function main() {
  const { total, words, chars, withBareId, withThreeBareIds, withBareIdStrict, withRefLink, earliest, latest } = run();

  console.log(`Athena reply-shape stats — ${BRAIN_DIR}`);
  console.log(since ? `since: ${since.toISOString()}` : 'since: (all history)');
  console.log('');
  if (total === 0) {
    console.log('replies: 0 (no assistant episodes matched — check --since / PERSONAS_BRAIN_DIR)');
    return;
  }
  console.log(`replies:              ${total}`);
  console.log(`date range:           ${earliest?.toISOString().slice(0, 10)} .. ${latest?.toISOString().slice(0, 10)}`);
  console.log(`median words:         ${fmt(median(words))}`);
  console.log(`p90 words:            ${fmt(percentile(words, 90))}`);
  console.log(`median chars:         ${fmt(median(chars))}`);
  console.log(`p90 chars:            ${fmt(percentile(chars, 90))}`);
  console.log(`>=1 bare id:          ${pct(withBareId, total)}%  (${withBareId}/${total})`);
  console.log(`>=3 bare ids:         ${pct(withThreeBareIds, total)}%  (${withThreeBareIds}/${total})`);
  // Comparison only, not a primary metric: how many of the above would still
  // count under the OLD (pre-amendment, all-code-spans-exempt) reading. The
  // gap between this line and the one above is roughly "how much of the
  // raw-id habit is backtick-wrapped inline code".
  console.log(`  (of which, strict — fenced+inline code both exempt: ${pct(withBareIdStrict, total)}%  (${withBareIdStrict}/${total}))`);
  console.log(`>=1 ref link:         ${pct(withRefLink, total)}%  (${withRefLink}/${total})`);

  const rpd = await reportsPerDay(earliest, latest);
  console.log(
    `reports/day:          ${rpd.value == null ? `n/a (${rpd.reason})` : `${rpd.value}  (${rpd.count} reports over ${rpd.days} day(s))`}`,
  );
}

main().catch((e) => {
  console.error('FATAL:', e.stack ?? e.message ?? e);
  process.exit(1);
});
