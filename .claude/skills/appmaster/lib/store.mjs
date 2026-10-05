// The headless journal: plain-file CRUD under .claude/master/<slug>/headless/ (WP0, finished here
// so WP1 and WP2 can test against it from the first minute). No database, no git, no network.
//
// JSONL files are append-only: a record that changes is APPENDED again and the LATEST line per
// key wins on read (wakes by wakeId, asks by askId, outbox by id). A crash between two writes
// therefore leaves the earlier line intact, never half a record.

import fs from 'node:fs';
import path from 'node:path';
import {
  STATE_ROOT, briefPath, headlessDir, wakesPath, asksPath, channelPath, outboxPath, runsDir, runDir,
  appendJsonl, readJsonl, readJson, writeJson, mintId, nowIso, sha1, canonical,
  RUN_STATES, OUTBOX_KINDS,
} from './contract.mjs';

// ---------------------------------------------------------------- brief

export const loadBrief = (slug) => readJson(briefPath(slug), null);
export const saveBrief = (slug, brief) => writeJson(briefPath(slug), brief);

/** Slugs that have a brief (the projects this skill manages). */
export function listSlugs() {
  let names; try { names = fs.readdirSync(STATE_ROOT); } catch { return []; }
  return names.filter((n) => fs.existsSync(briefPath(n))).sort();
}

// ---------------------------------------------------------------- latest-line-wins readers

function latestBy(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], { ...(m.get(r[key]) ?? {}), ...r });
  return [...m.values()];
}

// ---------------------------------------------------------------- wakes

export const loadWakes = (slug) => latestBy(readJsonl(wakesPath(slug)), 'wakeId');
export const lastWake = (slug) => loadWakes(slug).at(-1) ?? null;
export const loadWake = (slug, wakeId) => loadWakes(slug).find((w) => w.wakeId === wakeId) ?? null;
/** Append a wake line; a partial record merges over the earlier lines with the same wakeId. */
export const saveWake = (slug, wake) => { appendJsonl(wakesPath(slug), wake); return loadWake(slug, wake.wakeId); };

// ---------------------------------------------------------------- runs (one json file each)

/** Mint a run. The id exists BEFORE any effect: a crash after this line still names the intent. */
export function newRun(project, fields) {
  const run = {
    runId: mintId(), slug: project.slug, project, state: 'planned', createdAt: nowIso(),
    ideaIds: [], ...fields,
  };
  saveRun(run);
  return run;
}
export function saveRun(run) {
  if (!RUN_STATES.includes(run.state)) throw new Error(`bad run state ${run.state}`);
  writeJson(path.join(runDir(run.slug, run.runId), 'run.json'), run);
  return run;
}
export const loadRun = (slug, runId) => readJson(path.join(runDir(slug, runId), 'run.json'), null);
export function listRuns(slug, { states } = {}) {
  let ids; try { ids = fs.readdirSync(runsDir(slug)); } catch { return []; }
  return ids.map((id) => loadRun(slug, id)).filter(Boolean)
    .filter((r) => !states || states.includes(r.state))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
/** Find a run by id (full or the 8-char short form) across every managed project. */
export function findRun(runId) {
  for (const slug of listSlugs()) {
    const hit = listRuns(slug).find((r) => r.runId === runId || r.runId.replace(/-/g, '').startsWith(runId));
    if (hit) return hit;
  }
  return null;
}
export function updateRun(run, patch) { return saveRun({ ...run, ...patch }); }

// ---------------------------------------------------------------- outbox

export const outboxId = (kind, payload) => `${kind}:${sha1(canonical(payload))}`;
export const loadOutbox = (slug) => latestBy(readJsonl(outboxPath(slug)), 'id');
/** Queue a write the app owns. Idempotent: the same kind+payload queues once. Returns the entry. */
export function queueOutbox(slug, projectId, kind, payload, source = {}) {
  if (!OUTBOX_KINDS.includes(kind)) throw new Error(`bad outbox kind ${kind}`);
  const id = outboxId(kind, payload);
  const existing = loadOutbox(slug).find((e) => e.id === id);
  if (existing) return existing;
  const entry = { id, kind, slug, projectId, payload, source, queuedAt: nowIso(), state: 'queued', attempts: 0 };
  appendJsonl(outboxPath(slug), entry);
  return entry;
}
export const updateOutbox = (slug, id, patch) => { appendJsonl(outboxPath(slug), { id, ...patch }); return loadOutbox(slug).find((e) => e.id === id); };

// ---------------------------------------------------------------- asks

export const loadAsks = (slug) => latestBy(readJsonl(asksPath(slug)), 'askId');
export const openAsks = (slug) => loadAsks(slug).filter((a) => a.state === 'open');
export function raiseAsk(slug, ask) {
  const row = { askId: mintId(), slug, state: 'open', raisedAt: nowIso(), options: [], ...ask };
  appendJsonl(asksPath(slug), row);
  return row;
}
export const updateAsk = (slug, askId, patch) => { appendJsonl(asksPath(slug), { askId, ...patch }); return loadAsks(slug).find((a) => a.askId === askId); };

// ---------------------------------------------------------------- operator channel (say)

export const loadChannel = (slug) => readJsonl(channelPath(slug));
export const appendChannel = (slug, message, from = 'operator') => {
  const row = { id: mintId(), at: nowIso(), from, message };
  appendJsonl(channelPath(slug), row);
  return row;
};

export { headlessDir };
