// status and the terminal digest (WP1). Reads the journal and the run files directly (it does not
// import worker.mjs or limits.mjs, which WP2 owns) and never the app DB. Writes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_CAP, LIVE_RUN_STATES, PER_PROJECT_CAP, runDir, shortId } from './contract.mjs';
import { listRuns, listSlugs, loadBrief, loadOutbox, loadWakes, openAsks } from './store.mjs';
import { brakes, isDue, lastDecided, parseTs } from './brakes.mjs';
import { pressureReport } from './memory.mjs';
import { queueTable } from './queue.mjs';

/** Minutes since runs/<id>/stream.jsonl last changed, or null when there is no stream yet. */
export function streamAgeMin(slug, runId, nowMs = Date.now()) {
  try { return Math.max(0, Math.round((nowMs - fs.statSync(path.join(runDir(slug, runId), 'stream.jsonl')).mtimeMs) / 60000)); } catch { return null; }
}

/** One project's status record. */
export function projectStatus(slug, nowMs = Date.now()) {
  const wakes = loadWakes(slug);
  const last = lastDecided(wakes);
  const next = wakes.map((w) => w.nextWakeAt).filter(Boolean).sort().at(-1) ?? null;
  const runs = listRuns(slug);
  const brief = loadBrief(slug) ?? {};
  const name = wakes.filter((w) => w.project?.name).at(-1)?.project.name ?? brief.project ?? slug;
  return {
    slug, name, nextWakeAt: next, due: isDue(wakes, nowMs),
    running: runs.filter((r) => LIVE_RUN_STATES.includes(r.state)).map((r) => ({
      runId8: shortId(r.runId), charter: r.charterSlug, model: r.model, paths: r.paths ?? [], repo: r.repo ?? 'self', state: r.state, streamAgeMin: streamAgeMin(slug, r.runId, nowMs),
    })),
    held: runs.filter((r) => r.state === 'held').map((r) => ({ runId8: shortId(r.runId), charter: r.charterSlug, branch: r.branch ?? null, heldReason: r.heldReason ?? null })),
    merged: runs.filter((r) => r.state === 'merged' && last && String(r.endedAt ?? r.createdAt) >= String(last.at))
      .map((r) => ({ runId8: shortId(r.runId), charter: r.charterSlug, mergedSha: r.mergedSha ?? null })),
    reviewed: runs.filter((r) => r.state === 'reviewed' && r.council && last && String(r.settledAt ?? r.createdAt) >= String(last.at))
      .map((r) => ({ runId8: shortId(r.runId), charter: r.charterSlug, featureSlug: r.featureSlug ?? null, mode: r.council.mode, outcome: r.council.outcome })),
    queued: queueTable(nowMs).filter((q) => q.slug === slug).map((q) => ({ runId8: q.runId8, charter: q.charterSlug, position: q.position, reason: q.reason })),
    asksOpen: openAsks(slug).length,
    outboxDepth: loadOutbox(slug).filter((e) => e.state === 'queued').length,
    lastNote: last?.note ?? last?.decision?.note ?? null,
    lastDecisionAt: last?.decidedAt ?? last?.at ?? null,
    lastDispatch: last?.decision?.dispatch?.map((d) => d.charterSlug) ?? [],
    say: last?.decision?.say ?? null,
  };
}

const hhmm = (iso, nowMs) => {
  const t = parseTs(iso); if (!Number.isFinite(t)) return 'unknown';
  const d = new Date(t), today = new Date(nowMs).toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return today ? hm : `${d.toISOString().slice(5, 10)} ${hm}`;
};
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };

/** The per-project digest the Director prints each wake: lead with what moved, quiet projects one line. */
export function renderDigest(status, nowMs = Date.now()) {
  const L = [];
  const b = status.brakes;
  L.push(`Machine: ${b.memory.freeGb} GB free${b.memory.stop ? ` (dispatch paused: needs ${b.memory.dispatchNeedGb} GB)` : ''}${b.memory.gateOk === false ? ` (gates wait: need ${b.memory.gateNeedGb} GB)` : ''}; ${b.limit.limited ? `usage limit marked${b.limit.resetsAt ? ` until ${b.limit.resetsAt}` : ''}` : 'no usage limit'}; builders running ${status.caps.running} of ${status.caps.global}.`);
  if (status.pressure) L.push(`  Memory: ours ${status.pressure.ownGb} GB; biggest others: ${status.pressure.others.map((o) => `${o.name} ${o.gb} GB`).join(', ') || 'none'}.`);
  for (const p of status.projects) {
    const next = p.nextWakeAt ? `next wake ${hhmm(p.nextWakeAt, nowMs)}${p.due ? ' (due now)' : ''}` : 'no decision yet, due now';
    const queued = p.queued ?? [];
    const reviewed = p.reviewed ?? [];
    const quiet = !p.running.length && !p.held.length && !p.merged.length && !reviewed.length && !queued.length && !p.asksOpen && !p.outboxDepth && !p.lastDispatch.length && !p.say;
    if (quiet) { L.push(`${p.slug} - quiet, ${next}.`); continue; }
    L.push(`${p.slug} - ${p.lastDecisionAt ? `decided ${hhmm(p.lastDecisionAt, nowMs)}` : 'no decision yet'}${p.lastDispatch.length ? `, dispatched ${p.lastDispatch.join(', ')}` : ''}; ${next}.`);
    for (const m of p.merged) L.push(`  Merged ${m.runId8} ${m.charter}${m.mergedSha ? ` at ${String(m.mergedSha).slice(0, 8)}` : ''}.`);
    for (const r of reviewed) L.push(`  Reviewed ${r.runId8} ${r.featureSlug}: ${r.mode} council ${r.outcome}${r.mode === 'full' && r.outcome === 'ready' ? ' (report + approval queued for the operator)' : ''}.`);
    // a planned run in the queue is a promise, not running: the queue block below shows it
    for (const r of p.running.filter((x) => !queued.some((q) => q.runId8 === x.runId8))) L.push(`  ${r.state === 'running' ? 'Running' : `Run ${r.state}:`} ${r.runId8} ${r.charter} (${r.model ?? 'model ?'})${r.repo && r.repo !== 'self' ? ` in repo ${r.repo}` : ''}${r.streamAgeMin != null ? `, last output ${r.streamAgeMin} min ago` : ''}${r.paths?.length ? `; paths ${clip(r.paths.join(', '), 80)}` : ''}.`);
    for (const q of queued) L.push(`  Queued ${q.runId8} ${q.charter} at position ${q.position}, waiting on ${q.reason}.`);
    for (const h of p.held) L.push(`  Held ${h.runId8} ${h.charter}${h.heldReason ? `: ${clip(h.heldReason, 140)}` : ''}.`);
    if (p.lastNote) L.push(`  Note: ${clip(p.lastNote, 200)}`);
    if (p.say) L.push(`  Said: ${clip(p.say, 240)}`);
    if (p.asksOpen || p.outboxDepth) L.push(`  ${p.asksOpen ? `${p.asksOpen} ask(s) open` : 'No asks open'}; ${p.outboxDepth} outbox entr${p.outboxDepth === 1 ? 'y' : 'ies'} queued.`);
  }
  L.push(...renderQueue(status.queue ?? []));
  return L.join('\n');
}

/**
 * The admission queue as the digest's last block: position, project, charter, model, repo, waited
 * (minutes since enqueuedAt), and the refusal it waits on. Always rendered: an empty queue is a fact.
 */
export function renderQueue(rows) {
  if (!rows.length) return ['Queue: empty.'];
  const cols = [['#', (r) => String(r.position)], ['project', (r) => r.slug], ['charter', (r) => r.charterSlug], ['model', (r) => r.model ?? '?'],
    ['repo', (r) => r.repo ?? 'self'], ['waited', (r) => (r.waitedMin == null ? '?' : `${r.waitedMin} min`)], ['waits on', (r) => `${r.reason ?? '?'}${r.pinned ? ' (pinned)' : ''}`]];
  const width = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => f(r).length)));
  const line = (cells) => `  ${cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(width[i]))).join('  ')}`.trimEnd();
  return [`Queue: ${rows.length} waiting, in promotion order (FIFO by decision; \`queue move\` pins).`,
    line(cols.map(([h]) => h)), ...rows.map((r) => line(cols.map(([, f]) => f(r))))];
}

/** (args) => {projects:[...], caps:{running,global}, brakes} | {__text:true,text} with --text */
export async function cmdStatus({ flags = {} } = {}) {
  const nowMs = Date.now();
  let slugs = listSlugs();
  if (flags.project && flags.project !== true) {
    const want = String(flags.project).toLowerCase();
    const hit = slugs.find((s) => s === want) ?? slugs.find((s) => projectStatus(s, nowMs).name.toLowerCase() === want);
    if (!hit) throw new Error(`no managed project "${flags.project}" (managed: ${slugs.join(', ') || 'none'})`);
    slugs = [hit];
  }
  const projects = slugs.map((s) => projectStatus(s, nowMs));
  const b = brakes(null);
  const status = {
    projects,
    caps: { running: b.running.global, global: GLOBAL_CAP, perProject: PER_PROJECT_CAP },
    brakes: { memory: b.memory, limit: b.limit },
    queue: queueTable(nowMs),
  };
  // who is using the memory, only when a brake or the wait is in play (one PowerShell call, ~1 s)
  if (b.memory.stop || b.memory.gateOk === false || flags.pressure) {
    const rootPids = slugs.flatMap((s) => listRuns(s, { states: ['running'] })).map((r) => r.pid).filter(Boolean);
    status.pressure = pressureReport(rootPids);
  }
  if (flags.text) return { __text: true, text: renderDigest(status, nowMs) };
  return status;
}
