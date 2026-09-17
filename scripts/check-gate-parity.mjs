#!/usr/bin/env node
/**
 * Gate parity: every check lefthook enforces locally has a CI counterpart.
 *
 * WHY THIS EXISTS. `lefthook.yml` and `.github/workflows/` are two independently
 * authored answers to "which checks apply to this repo". Nothing connects them,
 * so a hook added locally is enforced on this machine and nowhere else, and the
 * gap is silent: the local hook goes green for the author, CI goes green without
 * ever having run it, and the check is effectively opt-in per developer. On
 * 2026-09-04 three of eleven local jobs had no CI counterpart, including the
 * secret scan — whose own comment in lefthook.yml notes that CI catching a leak
 * is already a leak, i.e. the local hook was the ONLY enforcement.
 *
 * WHAT IT CHECKS. For each lefthook job, resolve the command it runs (expanding
 * `npm run X` through package.json transitively, because CI invokes wrappers
 * rather than raw script paths) and assert the same underlying script or binary
 * appears somewhere in .github/workflows, itself expanded the same way.
 *
 * WHAT IT DOES NOT CHECK. Scope. A check present on both sides may still be
 * narrower in one of them; that is the next step (see
 * .ai/plans/2026-09-04-gate-parity.md). This asserts presence only.
 *
 * KNOWN-GAPS. Jobs deliberately local-only are listed in ALLOWED_LOCAL_ONLY with
 * a reason. An empty reason is not accepted — the point of the list is that
 * somebody argued for the exemption.
 *
 * Usage: node scripts/check-gate-parity.mjs [--json]
 * Exit 0 when every job is covered or exempt, 1 otherwise.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Jobs that are intentionally local-only. Every entry needs a real reason. */
const ALLOWED_LOCAL_ONLY = {
  // Nothing yet. Adding a job here is a deliberate act that lands in the diff.
};

function readJobs() {
  const text = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
  const jobs = [];
  let cur = null;
  let stage = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const mStage = line.match(/^(pre-commit|pre-push|commit-msg|post-merge|post-checkout):\s*$/);
    if (mStage) {
      stage = mStage[1];
      cur = null;
      continue;
    }
    const mName = line.match(/^\s*-\s*name:\s*(.+)$/);
    if (mName) {
      cur = { name: mName[1].trim(), stage, run: '', glob: '*' };
      jobs.push(cur);
      continue;
    }
    if (!cur) continue;
    const mRun = line.match(/^\s*run:\s*(.+)$/);
    if (mRun) cur.run = mRun[1].trim();
    const mGlob = line.match(/^\s*glob:\s*(.+)$/);
    if (mGlob) cur.glob = mGlob[1].trim().replace(/^["']|["']$/g, '');
  }
  return jobs;
}

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};

/** Inline every `npm run X` this command reaches, so wrappers do not hide a call. */
function expand(cmd, seen = new Set(), depth = 0) {
  if (depth > 8) return cmd;
  let out = cmd;
  for (const m of cmd.matchAll(/npm run ([\w:-]+)/g)) {
    const name = m[1];
    if (seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    out += '\n' + expand(scripts[name], seen, depth + 1);
  }
  return out;
}

/** The script paths and tool binaries a command actually invokes. */
function invocationKeys(run) {
  const expanded = expand(run);
  const keys = new Set();
  for (const m of expanded.matchAll(/((?:scripts|\.ai)\/[\w/.-]+\.(?:mjs|js|cjs|ts))/g)) keys.add(m[1]);
  for (const m of expanded.matchAll(/\b(eslint|tsc|rustfmt|clippy|vitest|cargo)\b/g)) keys.add(m[1]);
  if (keys.size === 0) keys.add(run.split(/\s+/).slice(0, 2).join(' '));
  return [...keys];
}

const wfDir = join(ROOT, '.github/workflows');
const ciText = expand(
  readdirSync(wfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => readFileSync(join(wfDir, f), 'utf8'))
    .join('\n'),
);

const rows = readJobs().map((j) => {
  const keys = invocationKeys(j.run);
  const covered = keys.some((k) => ciText.includes(k));
  const exempt = Object.prototype.hasOwnProperty.call(ALLOWED_LOCAL_ONLY, j.name);
  return { ...j, keys, covered, exempt };
});

const gaps = rows.filter((r) => !r.covered && !r.exempt);
const asJson = process.argv.includes('--json');

if (asJson) {
  console.log(JSON.stringify({ jobs: rows.length, gaps }, null, 2));
} else {
  for (const r of rows) {
    const mark = r.covered ? 'ci ' : r.exempt ? 'ex ' : 'GAP';
    console.log(`  [${mark}] ${r.stage}/${r.name}`);
  }
  console.log('');
  if (gaps.length === 0) {
    console.log(`gate parity OK — ${rows.length} local jobs, every one enforced in CI or exempt`);
  } else {
    console.log(`gate parity FAILED — ${gaps.length}/${rows.length} local job(s) enforced nowhere but this machine:`);
    for (const g of gaps) console.log(`    - ${g.stage}/${g.name}  invokes [${g.keys.join(', ')}]`);
    console.log('');
    console.log('Fix by adding the check to a workflow, or by listing it in');
    console.log('ALLOWED_LOCAL_ONLY in this file with the reason it stays local.');
  }
}

process.exit(gaps.length === 0 ? 0 : 1);
