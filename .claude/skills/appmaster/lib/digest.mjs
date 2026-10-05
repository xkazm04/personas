// status and the terminal digest (WP1). Reads the journal and the run files directly (it does not
// import worker.mjs or limits.mjs, which WP2 owns) and never the app DB. Writes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_CAP, LIVE_RUN_STATES, PER_PROJECT_CAP, runDir, shortId } from './contract.mjs';
import { listRuns, listSlugs, loadBrief, loadOutbox, loadWakes, openAsks } from './store.mjs';
import { brakes, isDue, lastDecided, parseTs } from './brakes.mjs';

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
      runId8: shortId(r.runId), charter: r.charterSlug, model: r.model, state: r.state, streamAgeMin: streamAgeMin(slug, r.runId, nowMs),
    })),
    held: runs.filter((r) => r.state === 'held').map((r) => ({ runId8: shortId(r.runId), charter: r.charterSlug, branch: r.branch ?? null, heldReason: r.heldReason ?? null })),
    merged: runs.filter((r) => r.state === 'merged' && last && String(r.endedAt ?? r.createdAt) >= String(last.at))
      .map((r) => ({ runId8: shortId(r.runId), charter: r.charterSlug, mergedSha: r.mergedSha ?? null })),
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
  L.push(`Machine: memory ${b.memory.usedPct}% used${b.memory.stop ? ' (dispatch brake tripped)' : ''}; ${b.limit.limited ? `usage limit marked${b.limit.resetsAt ? ` until ${b.limit.resetsAt}` : ''}` : 'no usage limit'}; builders running ${status.caps.running} of ${status.caps.global}.`);
  for (const p of status.projects) {
    const next = p.nextWakeAt ? `next wake ${hhmm(p.nextWakeAt, nowMs)}${p.due ? ' (due now)' : ''}` : 'no decision yet, due now';
    const quiet = !p.running.length && !p.held.length && !p.merged.length && !p.asksOpen && !p.outboxDepth && !p.lastDispatch.length && !p.say;
    if (quiet) { L.push(`${p.slug} - quiet, ${next}.`); continue; }
    L.push(`${p.slug} - ${p.lastDecisionAt ? `decided ${hhmm(p.lastDecisionAt, nowMs)}` : 'no decision yet'}${p.lastDispatch.length ? `, dispatched ${p.lastDispatch.join(', ')}` : ''}; ${next}.`);
    for (const m of p.merged) L.push(`  Merged ${m.runId8} ${m.charter}${m.mergedSha ? ` at ${String(m.mergedSha).slice(0, 8)}` : ''}.`);
    for (const r of p.running) L.push(`  ${r.state === 'running' ? 'Running' : `Run ${r.state}:`} ${r.runId8} ${r.charter} (${r.model ?? 'model ?'})${r.streamAgeMin != null ? `, last output ${r.streamAgeMin} min ago` : ''}.`);
    for (const h of p.held) L.push(`  Held ${h.runId8} ${h.charter}${h.heldReason ? `: ${clip(h.heldReason, 140)}` : ''}.`);
    if (p.lastNote) L.push(`  Note: ${clip(p.lastNote, 200)}`);
    if (p.say) L.push(`  Said: ${clip(p.say, 240)}`);
    if (p.asksOpen || p.outboxDepth) L.push(`  ${p.asksOpen ? `${p.asksOpen} ask(s) open` : 'No asks open'}; ${p.outboxDepth} outbox entr${p.outboxDepth === 1 ? 'y' : 'ies'} queued.`);
  }
  return L.join('\n');
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
  };
  if (flags.text) return { __text: true, text: renderDigest(status, nowMs) };
  return status;
}
