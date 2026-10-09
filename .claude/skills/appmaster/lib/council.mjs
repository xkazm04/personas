// The council lane (review runs). A review run's builder runs `/council --lite <feature>` (lite) or
// `/council <feature>` (full) in a worktree of the project repo and writes NO code; the council writes
// a run directory `<YYYY-MM-DD>-<feature>-r<n>/` under COUNCIL.runsRel holding result.json and report.md.
//
// This file owns what is specific to that lane: seeding the worktree with the feature's earlier rounds
// (the council counts its round and measures drift from them, and a fresh worktree would always say
// round 1), finding the run directory THIS run produced (never one that was there before), reading
// its result, copying it somewhere durable (the worktree is removed), the report a full `ready` sends
// to the human gate, and each feature's council state for the master's context.
// It never writes the app DB and never edits a file in a project checkout (it only reads state.json
// and earlier run directories there).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COUNCIL, councilDir, readJson, shortId } from './contract.mjs';
import { listRuns } from './store.mjs';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The council's run-directory convention (SKILL.md "Round"): full `<YYYY-MM-DD>-<feature>-r<n>`, lite
 * (council >= 0.4.0) `<YYYY-MM-DD>-<feature>-lite-r<n>`. Rounds are counted per mode, so each mode
 * matches only its own directories.
 */
export const councilRunDirRe = (featureSlug, mode = 'full') =>
  new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRe(featureSlug)}${mode === 'lite' ? '-lite' : ''}-r(\\d+)$`);
export const roundOfName = (name) => Number(/-r(\d+)$/.exec(String(name))?.[1] ?? 0);

/**
 * Where a review worktree finds the declared users, read from the base branch: tracked
 * uat/characters/*.md, or a tracked .claude/council/config.md with a `## Characters` section. A worktree
 * carries tracked files only, so a gitignored overlay counts as none. Measured 2026-10-07: the first lite
 * round of kp, pof and devsecops each came back incomplete at coverage 0.4 with "value is unmeasured: no
 * declared characters", one of three rounds burned per feature on a gap the context could have named.
 * @returns {{source: string|null, count?: number|null, unknown?: true}}
 */
export function charactersOf(root, baseBranch) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const tracked = (p) => git(['ls-tree', '-r', '--name-only', `refs/heads/${baseBranch}`, '--', p]).split(/\r?\n/).filter(Boolean);
  try {
    const md = tracked('uat/characters').filter((f) => /\.md$/i.test(f));
    if (md.length) return { source: 'uat/characters', count: md.length };
    if (tracked('.claude/council/config.md').length
      && /^##\s+Characters\b/m.test(git(['show', `refs/heads/${baseBranch}:.claude/council/config.md`]))) {
      return { source: '.claude/council/config.md', count: null };
    }
    return { source: null };
  } catch { return { source: null, unknown: true }; }
}
const listDirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const keyOf = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
function isInside(child, parent) {
  const rel = path.relative(keyOf(parent), keyOf(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
/** ISO or SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) -> ms; 0 when unreadable (the app DB mixes both). */
const tms = (s) => {
  const t = String(s ?? '').trim();
  const v = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? `${t.replace(' ', 'T')}Z` : t);
  return Number.isFinite(v) ? v : 0;
};
/** must_address, bounded: the first COUNCIL.mustAddressItems lines of at most mustAddressChars each. */
export const boundedMustAddress = (list) => (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.trim())
  .slice(0, COUNCIL.mustAddressItems).map((x) => clip(x, COUNCIL.mustAddressChars));

// ---------------------------------------------------------------- the worktree, before and after

/**
 * (run, repoRoot) => {copied, present, stateCopied, expectedRound}
 * Before the reviewer starts: copy this feature's earlier rounds OF THE SAME MODE into the worktree's
 * runs directory (from the journal's durable copies; a full council also takes the rounds an
 * interactive /council left in the checkout), and the checkout's state.json (a person's last decision:
 * a rejection's reason opens the next round). `present` is everything matching the feature there now:
 * settle never mistakes one of these for the run this reviewer produced.
 */
export function seedCouncil(run, repoRoot) {
  const runsDir = path.join(run.worktree, COUNCIL.runsRel);
  fs.mkdirSync(runsDir, { recursive: true });
  const re = councilRunDirRe(run.featureSlug, run.councilMode);
  const copied = [];
  const copyIn = (src, name) => {
    const dest = path.join(runsDir, name);
    if (fs.existsSync(dest) || !fs.existsSync(src)) return;
    fs.cpSync(src, dest, { recursive: true });
    copied.push(name);
  };
  for (const r of listRuns(run.slug, { states: ['reviewed'] })) {
    const c = r.council;
    if (c?.copyPath && r.featureSlug === run.featureSlug && r.councilMode === run.councilMode) copyIn(c.copyPath, c.runDirName);
  }
  if (run.councilMode === 'full') {
    const src = path.join(repoRoot, COUNCIL.runsRel);
    for (const name of listDirs(src).filter((n) => re.test(n))) copyIn(path.join(src, name), name);
  }
  let stateCopied = false;
  const stateSrc = path.join(repoRoot, COUNCIL.stateRel), stateDst = path.join(run.worktree, COUNCIL.stateRel);
  if (fs.existsSync(stateSrc) && !fs.existsSync(stateDst)) {
    fs.mkdirSync(path.dirname(stateDst), { recursive: true });
    fs.copyFileSync(stateSrc, stateDst);
    stateCopied = true;
  }
  const present = listDirs(runsDir).filter((n) => re.test(n)).sort((a, b) => roundOfName(a) - roundOfName(b));
  return { copied, present, stateCopied, expectedRound: (present.length ? Math.max(...present.map(roundOfName)) : 0) + 1 };
}

/**
 * (run, claim) => {dir, from:'claim'|'discovered'} | null
 * The run directory THIS review produced: the one the reviewer's result.json names, if it is inside the
 * worktree, follows the naming convention for this feature and was not there before (councilSeeded);
 * else the highest round under COUNCIL.runsRel that was not there before. The claim is a hint, never trusted.
 */
export function findCouncilRunDir(run, claim) {
  const re = councilRunDirRe(run.featureSlug, run.councilMode);
  const before = new Set(run.councilSeeded ?? []);
  const fresh = (abs) => isInside(abs, run.worktree) && re.test(path.basename(abs)) && !before.has(path.basename(abs))
    && fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  const named = claim?.councilRunDir ?? claim?.runDir ?? null;
  if (typeof named === 'string' && named.trim()) {
    const abs = path.resolve(run.worktree, named.trim());
    if (fresh(abs)) return { dir: abs, from: 'claim' };
  }
  const runsDir = path.join(run.worktree, COUNCIL.runsRel);
  const found = listDirs(runsDir).filter((n) => re.test(n) && !before.has(n)).sort((a, b) => roundOfName(b) - roundOfName(a) || b.localeCompare(a));
  return found.length ? { dir: path.join(runsDir, found[0]), from: 'discovered' } : null;
}

/** (dir) => {result} | {error}   result.json must exist, parse, and carry an outcome of COUNCIL.outcomes. */
export function readCouncilResult(dir) {
  const file = path.join(dir, 'result.json');
  if (!fs.existsSync(file)) return { error: 'no result.json' };
  const result = readJson(file, null);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { error: 'a result.json that does not parse as a JSON object' };
  if (!COUNCIL.outcomes.includes(result.outcome)) return { error: `a result.json whose outcome ${JSON.stringify(result.outcome)} is not one of ${COUNCIL.outcomes.join(', ')}` };
  return { result };
}

/** Copy a council run directory to the journal (councilDir), never over an existing copy. => the copy's absolute path */
export function copyCouncilRun(run, dir) {
  const root = councilDir(run.slug);
  fs.mkdirSync(root, { recursive: true });
  let dest = path.join(root, path.basename(dir));
  if (fs.existsSync(dest)) dest = `${dest}~${shortId(run.runId)}`;
  if (fs.existsSync(dest)) throw new Error(`the council copy ${dest} already exists`);
  fs.cpSync(dir, dest, { recursive: true, errorOnExist: true, force: false });
  return dest;
}

const ATTACHABLE = COUNCIL.attachable;
/** Screenshots and evidence files of a council run directory (copied), bounded: [{path, caption}]. */
export function reportAttachments(copyDir) {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= COUNCIL.attachmentsMax) return;
      const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(abs, r, depth + 1); continue; }
      // only types the reports door accepts (2026-10-07: an evidence/gates/.gates-finished marker was refused 400);
      // the top-level report.md is the report's content already, not an attachment
      if (ATTACHABLE.test(e.name) && r !== 'report.md') out.push({ path: abs, caption: r });
    }
  };
  walk(copyDir, '', 0);
  return out;
}

/** The title of a full-ready council report, and the feature a title names (null for any other title).
 * dbread reads it back to tie an Approval decided anywhere (the desk or the phone) to its feature. */
export const reportTitle = (featureSlug, round) => `Council ready: ${featureSlug} (full council, round ${round})`;
export const featureOfReportTitle = (title) => /^Council ready: (\S+) \(full council, round /.exec(String(title ?? ''))?.[1] ?? null;

/**
 * The `report` outbox payload a FULL council `ready` sends to the human gate: the council's report.md
 * (bounded), its screenshots/evidence as attachments, and an Approval only the operator can answer.
 */
export function reportPayload(run, result, copyDir) {
  let content = '';
  try { content = fs.readFileSync(path.join(copyDir, 'report.md'), 'utf8'); } catch { /* no report.md */ }
  if (!content.trim()) {
    content = [`# Council: ${run.featureSlug}`, '', String(result.summary ?? '(no summary)'), '',
      ...(Array.isArray(result.must_address) && result.must_address.length ? ['## Must address', ...result.must_address.map((m) => `- ${m}`)] : [])].join('\n');
  }
  if (content.length > COUNCIL.reportMax) content = `${content.slice(0, COUNCIL.reportMax - 60)}\n\n[report cut at ${COUNCIL.reportMax} characters; the full one is in ${copyDir}]`;
  const num = (v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a');
  return {
    projectId: run.project.id,
    title: reportTitle(run.featureSlug, result.round_no ?? roundOfName(path.basename(copyDir))),
    content,
    attachments: reportAttachments(copyDir),
    approval: {
      title: `Approve ${run.featureSlug}?`,
      description: `The full council found ${run.featureSlug} ready (overall ${num(result.overall)}, coverage ${num(result.coverage)}). The council never approves: approve or reject it here. The run directory is ${copyDir}.`,
      severity: 'info',
    },
  };
}

// ---------------------------------------------------------------- a feature's council state

/** The journal's council history of one project: every reviewed run's record, oldest first. */
export function councilJournal(slug) {
  return listRuns(slug, { states: ['reviewed'] }).filter((r) => r.council)
    .map((r) => ({ featureSlug: r.featureSlug, mode: r.councilMode ?? r.council.mode, outcome: r.council.outcome, at: r.settledAt ?? r.endedAt ?? r.createdAt,
      mustAddress: r.council.mustAddress ?? [], runDirName: r.council.runDirName, round: r.council.round ?? null, runId: r.runId }))
    .sort((a, b) => tms(a.at) - tms(b.at));
}

/**
 * Every council event of a feature: the journal's (the mode is known) plus the app's dev_council_runs
 * rows that no journal record accounts for (an interactive /council: a full one).
 */
export function councilEvents(featureSlug, journal = [], dbRuns = []) {
  const mine = journal.filter((j) => j.featureSlug === featureSlug);
  const known = new Set(mine.map((j) => String(j.runDirName).toLowerCase()));
  const fromDb = dbRuns.filter((r) => r.slug === featureSlug && !known.has(path.basename(String(r.run_dir ?? '').replace(/\\/g, '/')).toLowerCase()))
    .map((r) => {
      let ma = []; try { ma = JSON.parse(r.must_address_json || '[]'); } catch { /* unreadable */ }
      return { featureSlug, mode: 'full', outcome: r.outcome, at: r.at, mustAddress: boundedMustAddress(ma), round: r.round_no, runDirName: path.basename(String(r.run_dir ?? '')) };
    });
  return [...mine, ...fromDb].sort((a, b) => tms(a.at) - tms(b.at));
}

/** {lite, full}: rounds a feature has used per council mode. Round 4 of a mode is refused (stalled). */
export function roundsUsed(events) {
  return { lite: events.filter((e) => e.mode === 'lite').length, full: events.filter((e) => e.mode === 'full').length };
}

/**
 * (feature, events, decisions) => {state, mustAddress, rounds}
 * state: none | lite-ready | lite-fail | lite-incomplete | full-ready | full-fail | full-incomplete |
 * stalled | approved | rejected. A person's decision wins when it is the newest thing that happened.
 */
export function featureState(featureSlug, events, decisions = []) {
  const last = events.at(-1) ?? null;
  const decision = decisions.filter((d) => d.slug === featureSlug).sort((a, b) => tms(a.decided_at) - tms(b.decided_at)).at(-1) ?? null;
  const rounds = roundsUsed(events);
  if (decision && (!last || tms(decision.decided_at) >= tms(last.at))) {
    return { state: decision.decision, mustAddress: decision.decision === 'rejected' && decision.reason ? [clip(decision.reason, COUNCIL.mustAddressChars)] : [], rounds };
  }
  if (!last) return { state: 'none', mustAddress: [], rounds };
  return { state: last.outcome === 'stalled' ? 'stalled' : `${last.mode}-${last.outcome}`, mustAddress: last.mustAddress ?? [], rounds };
}
