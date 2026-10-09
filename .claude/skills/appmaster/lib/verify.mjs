// The FULL gate (operator, 2026-10-09). The merge gate narrows `test` to a branch's changed area
// (gate.mjs testFocus), so a change can break an unrelated feature and still merge: the operator's
// accepted risk. `verify` closes it before anything leaves the machine: every gate, with the full test
// command, on a throwaway checkout of the base tip, with FULL_GATE_TIMEOUT_MS. Run it before a push or a
// release, and on demand. It writes no code and touches no checkout; it records one line in the journal
// (headless/verify.jsonl) and, when red, raises ONE ask naming what failed.
//
//   verify --project <p> [--repo <key>] [--timeout-min N]

import path from 'node:path';
import { nowIso, Refusal, repoEnv, headlessDir, appendJsonl, readJsonl } from './contract.mjs';
import { loadBrief, raiseAsk, openAsks, updateAsk } from './store.mjs';
import { resolveProject } from './dbread.mjs';
import { resolveRepo } from './repos.mjs';
import { resolveRunGates, runGates, gatesVerdict, FULL_GATE_TIMEOUT_MS } from './gate.mjs';
import { revParse, withBaseWorktree } from './worktree.mjs';
import { acquireGateSlot } from './memory.mjs';

export const verifyPath = (slug) => path.join(headlessDir(slug), 'verify.jsonl');
export const lastVerify = (slug) => readJsonl(verifyPath(slug)).at(-1) ?? null;

const ASK_PREFIX = 'Full gate red';

/** One line per failed gate: its first recognised failures, else its exit. */
function summarise(results) {
  return Object.entries(results)
    .filter(([, r]) => !r.skipped && !r.ok)
    .map(([g, r]) => `${g}: ${r.timedOut ? 'timed out' : `exit ${r.exit}`}${r.failures?.length ? ` (${r.failures.slice(0, 3).join(' | ')}${r.failures.length > 3 ? `, +${r.failures.length - 3} more` : ''})` : ''}`);
}

export function cmdVerify({ flags = {} } = {}) {
  if (!flags.project || flags.project === true) throw new Error('--project <slug> is required');
  const project = resolveProject(flags.project);
  const brief = loadBrief(project.slug);
  if (!brief) throw new Error(`no brief for ${project.slug}: run onboard first`);
  const target = resolveRepo(project, brief, flags.repo === true ? undefined : flags.repo);
  if (!target) throw new Refusal('unknown repo', { slug: project.slug, repo: flags.repo });
  const baseSha = revParse(target.repoRoot, `refs/heads/${target.repoBase}`);
  // A run-shaped record, so the shared helpers (gates of THIS repo, a base worktree) apply unchanged.
  const run = { slug: project.slug, runId: `verify${Date.now().toString(36)}`, project, baseSha, ...target };
  const gates = resolveRunGates(run, brief);
  const timeoutMs = flags['timeout-min'] && flags['timeout-min'] !== true
    ? Math.max(1, Number(flags['timeout-min'])) * 60000
    : Number(process.env.APPMASTER_FULL_GATE_TIMEOUT_MS) || FULL_GATE_TIMEOUT_MS;

  const release = acquireGateSlot({ label: `verify ${project.slug}` });
  const started = Date.now();
  let results;
  try {
    results = withBaseWorktree(run, (dir) => runGates(dir, gates, { timeoutMs, env: repoEnv(target.repoRoot) }));
  } finally { release(); }

  const gv = gatesVerdict(results);
  const red = summarise(results);
  const record = {
    at: nowIso(), slug: project.slug, repo: target.repo, baseBranch: target.repoBase, baseSha,
    ok: gv.ok, ran: gv.ran, failed: gv.failed, skipped: gv.skipped, red, minutes: Math.round((Date.now() - started) / 6000) / 10,
    gates: Object.fromEntries(Object.entries(results).map(([g, r]) => [g, { ok: r.ok, exit: r.exit, skipped: r.skipped || undefined, timedOut: r.timedOut || undefined, failures: (r.failures || []).slice(0, 50), command: r.command }])),
  };
  appendJsonl(verifyPath(project.slug), record);

  // One standing ask per repo: a new red replaces the last red's ask; a green closes it.
  const mine = openAsks(project.slug).filter((a) => a.source === 'verify' && a.repo === target.repo);
  for (const a of mine) {
    updateAsk(project.slug, a.askId, { state: 'answered', answer: { choice: '(closed by verify)', notes: gv.ok ? `the full gate is green at ${baseSha.slice(0, 10)}` : 'superseded by a newer full-gate run', at: nowIso() } });
  }
  let ask = null;
  if (!gv.ok) {
    ask = raiseAsk(project.slug, {
      wakeId: null, source: 'verify', kind: 'verify-red', repo: target.repo,
      question: `${ASK_PREFIX} on ${target.repoBase} at ${baseSha.slice(0, 10)} (${project.slug}${target.repo !== 'self' ? `, repo ${target.repo}` : ''}): ${red.join('; ') || 'no gate could run'}. What should happen before a push?`,
      context: `The merge gate tests only each branch's changed area, so this can be a change that merged green and broke something else. The full gate ran every suite with a ${Math.round(timeoutMs / 60000)}-minute limit.`,
      options: [
        { label: 'Fix it first', action: 'The master dispatches one delivery that makes the full gate green; nothing is pushed until it is.' },
        { label: 'It is inherited, record it', action: 'Record the failures as known red on the base, and push on that basis.' },
        { label: 'I will look myself', action: 'Nothing is dispatched; you investigate.' },
      ],
    });
  }
  return { ...record, ask: ask ? { askId: ask.askId, question: ask.question } : null };
}
