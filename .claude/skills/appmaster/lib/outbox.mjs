// The outbox replay (WP1): every write the app owns, queued by decide/answer/say/settle, replayed
// through the app's own doors when it is up. Never writes the app DB: it reads it (read-only) to
// check an effect is not already there BEFORE posting, posts through a door, and reads it again
// AFTER, because the test bridge's echo is not evidence (results over 380 chars come back {big:n}).
//
// Doors (src-tauri/src/commands/infrastructure/dev_tools_http.rs route table ~141, write-back
// routes ~1694; app_master_writeback.rs record_idea_outcome ~261):
//   idea-verdict  -> invoke dev_tools_update_idea {id, status, rejectionReason}  (dev_tools.rs ~491)
//   task-complete -> POST /dev-tools/ideas/{id}/outcome {outcome:'delivered', commit, branch, note}
//                    per idea (the worker write-back door: it mints or reuses the task, appends
//                    "commit: <sha>" to its description and writes the idea back); with no idea ids,
//                    invoke dev_tools_create_task with the SHA in the description (dev_tools.rs ~991)
//   ask raise     -> NO DOOR (see NO_DOOR.askRaise): marked skipped, never written as SQL
//   ask resolve   -> invoke update_manual_review_status {id, status:'resolved', reviewerNotes}
//   say           -> invoke post_persona_channel_message {personaId, content, clientId:null}
//                    for the operator's own words; the master's say has no door (NO_DOOR.masterSay)

import { OUTBOX_STATES, Refusal, nowIso } from './contract.mjs';
import { listSlugs, loadOutbox, updateOutbox } from './store.mjs';
import { masterPersona, one, openDb, resolveManaged } from './dbread.mjs';
import * as bridge from './bridge.mjs';

export const NO_DOOR = {
  askRaise: 'no door: persona_manual_reviews has no create command or dev-tools route. The in-app raise '
    + '(attention.rs raise_asks ~7002) needs a persona_executions row as its FK anchor; the only bridge-callable '
    + 'inserters are seed_mock_manual_review (debug builds, random persona and title) and synthesize_manual_review '
    + '(spawns the auto-triage evaluator). The ask stays in asks.jsonl and is answered from the terminal.',
  masterSay: 'no door: post_persona_channel_message authors every message as the operator (author_kind user) '
    + 'and starts a follow-up run of the persona; no door posts as the persona. The master\'s say is in the '
    + 'wake record and the terminal digest.',
};
const REPLAYABLE = ['queued', 'failed'];
const id8 = (s) => String(s ?? '').slice(0, 8);
const res = (state, evidence, extra = {}) => ({ state, evidence, ...extra });

/** The default doors: the live bridge. Tests pass a fake with the same two functions. */
export const defaultDoors = () => ({ invoke: bridge.invoke, devTools: bridge.devTools });

// ---------------------------------------------------------------- per-kind replay

async function ideaVerdict(e, { db, doors, dryRun }) {
  const { ideaId, status, reason } = e.payload;
  const read = () => one(db, 'select status from dev_ideas where id = ?', [ideaId]);
  const before = read();
  if (!before) return res('skipped', `no idea ${ideaId} in the app DB`);
  if (before.status === status) return res('skipped', `already applied: idea ${id8(ideaId)} is ${status}`);
  if (before.status !== 'pending') return res('skipped', `superseded: idea ${id8(ideaId)} is ${before.status}; a ${status} verdict is not written over it`);
  if (dryRun) return res('queued', `would invoke dev_tools_update_idea (idea ${id8(ideaId)} pending -> ${status})`);
  if (typeof doors.invoke !== 'function') return res('skipped', 'no door: doors.invoke is absent');
  await doors.invoke('dev_tools_update_idea', status === 'rejected' ? { id: ideaId, status, rejectionReason: reason } : { id: ideaId, status });
  const after = read();
  return after?.status === status
    ? res('replayed', `db: idea ${id8(ideaId)} status ${status}`)
    : res('failed', `post-check: idea ${id8(ideaId)} is ${after?.status ?? 'missing'} after the door answered`);
}

async function taskComplete(e, { db, doors, dryRun }) {
  const { ideaIds = [], sha, title, runId, branch } = e.payload;
  if (!sha) return res('skipped', 'no commit sha in the payload: nothing to prove');
  const hasTask = (ideaId) => (ideaId
    ? one(db, 'select id from dev_tasks where source_idea_id = ? and description like ?', [ideaId, `%${sha}%`])
    : one(db, 'select id from dev_tasks where project_id = ? and source_idea_id is null and description like ?', [e.projectId, `%${sha}%`]));
  const targets = ideaIds.length ? ideaIds : [null];
  const gone = targets.filter((i) => i && !one(db, 'select id from dev_ideas where id = ?', [i]));
  const live = targets.filter((i) => !gone.includes(i));
  const goneNote = gone.length ? `; not in the app DB: ${gone.map(id8).join(', ')}` : '';
  if (!live.length) return res('skipped', `no idea of this run is in the app DB${goneNote}`);
  const missing = live.filter((i) => !hasTask(i));
  if (!missing.length) return res('skipped', `already applied: a task carrying ${sha.slice(0, 8)} exists for ${live.map((i) => (i ? id8(i) : 'the project')).join(', ')}${goneNote}`);
  const doorName = (i) => (i ? `POST /ideas/${id8(i)}/outcome` : 'invoke dev_tools_create_task');
  if (dryRun) return res('queued', `would ${missing.map(doorName).join(', ')}${goneNote}`);
  for (const i of missing) {
    if (i) {
      if (typeof doors.devTools !== 'function') return res('skipped', 'no door: doors.devTools is absent');
      await doors.devTools(`/ideas/${encodeURIComponent(i)}/outcome`, { outcome: 'delivered', commit: sha, branch: branch ?? null, note: `headless App Master run ${id8(runId)}: ${title ?? ''}`.trim() });
    } else {
      if (typeof doors.invoke !== 'function') return res('skipped', 'no door: doors.invoke is absent');
      await doors.invoke('dev_tools_create_task', {
        projectId: e.projectId, title: title || `Headless App Master run ${id8(runId)}`,
        description: `Delivered by headless App Master run ${runId}\nbranch: ${branch ?? ''}\ncommit: ${sha}\n`,
        sourceIdeaId: null, goalId: null, status: 'completed', depth: null,
      });
    }
  }
  const still = live.filter((i) => !hasTask(i));
  return still.length
    ? res('failed', `post-check: no task carrying ${sha.slice(0, 8)} for ${still.map((i) => (i ? id8(i) : 'the project')).join(', ')} after the door answered${goneNote}`)
    : res('replayed', `db: a task carrying ${sha.slice(0, 8)} exists for ${live.map((i) => (i ? id8(i) : 'the project')).join(', ')}${goneNote}`);
}

const reviewByTitle = (db, personaId, title) => one(db,
  'select id, status from persona_manual_reviews where persona_id = ? and title = ? order by created_at desc limit 1', [personaId, title]);

async function ask(e, { db, doors, dryRun }) {
  const p = e.payload;
  const persona = masterPersona(db, e.projectId);
  if ((p.op ?? 'raise') === 'raise') {
    const row = persona && p.question ? reviewByTitle(db, persona.id, p.question) : null;
    if (row) return res('skipped', `already applied: review ${id8(row.id)} is ${row.status}`);
    return res('skipped', NO_DOOR.askRaise);
  }
  if (p.op !== 'resolve') return res('skipped', `unknown ask op "${p.op}"`);
  if (!persona) return res('skipped', 'no App Master persona in the app for this project: no review row to resolve');
  const read = () => reviewByTitle(db, persona.id, p.question);
  const before = read();
  if (!before) return res('skipped', 'no review row to resolve: the ask was raised headless and a raise has no door');
  if (before.status !== 'pending') return res('skipped', `already applied: review ${id8(before.id)} is ${before.status}`);
  if (dryRun) return res('queued', `would invoke update_manual_review_status (review ${id8(before.id)} -> resolved)`);
  if (typeof doors.invoke !== 'function') return res('skipped', 'no door: doors.invoke is absent');
  await doors.invoke('update_manual_review_status', { id: before.id, status: 'resolved', reviewerNotes: `${p.choice}${p.notes ? `: ${p.notes}` : ''}` });
  const after = read();
  return after?.status === 'resolved'
    ? res('replayed', `db: review ${id8(before.id)} resolved`)
    : res('failed', `post-check: review ${id8(before.id)} is ${after?.status ?? 'missing'} after the door answered`);
}

async function say(e, { db, doors, dryRun }) {
  const { message, from = 'master' } = e.payload;
  if (from !== 'operator') return res('skipped', NO_DOOR.masterSay);
  const persona = masterPersona(db, e.projectId);
  if (!persona) return res('skipped', 'no App Master persona in the app for this project: no channel to post to');
  const read = () => one(db, "select id from team_channel_messages where persona_id = ? and author_kind = 'user' and body = ?", [persona.id, message]);
  const before = read();
  if (before) return res('skipped', `already applied: channel message ${id8(before.id)}`);
  if (dryRun) return res('queued', `would invoke post_persona_channel_message (persona ${id8(persona.id)})`);
  if (typeof doors.invoke !== 'function') return res('skipped', 'no door: doors.invoke is absent');
  await doors.invoke('post_persona_channel_message', { personaId: persona.id, content: message, clientId: null });
  const after = read();
  return after ? res('replayed', `db: channel message ${id8(after.id)}`) : res('failed', 'post-check: the message is not in the channel after the door answered');
}

const HANDLERS = { 'idea-verdict': ideaVerdict, 'task-complete': taskComplete, ask, say };

/**
 * (entry, {dryRun, doors, db}) => {state, evidence}   // read-only DB check before and after posting.
 * dryRun never calls a door. A door that throws is `failed` with the error as evidence.
 */
export async function replayEntry(entry, { dryRun = false, doors = defaultDoors(), db } = {}) {
  const handler = HANDLERS[entry.kind];
  if (!handler) return res('skipped', `no door: unknown outbox kind ${entry.kind}`);
  const own = !db; if (own) db = openDb();
  try {
    return await handler(entry, { db, doors: doors ?? {}, dryRun });
  } catch (err) {
    return res('failed', `door error: ${String(err?.message || err).split('\n')[0].slice(0, 300)}`);
  } finally { if (own) db.close(); }
}

// ---------------------------------------------------------------- the subcommand

function slugsOf(flags) {
  return flags.project && flags.project !== true ? [resolveManaged(flags.project).slug] : listSlugs();
}
const ageMin = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60000) : null);
const summary = (e) => ({
  slug: e.slug, id: e.id, kind: e.kind, op: e.kind === 'ask' ? (e.payload?.op ?? 'raise') : undefined,
  state: e.state, ageMin: ageMin(e.queuedAt), source: e.source ?? {}, attempts: e.attempts ?? 0, evidence: e.evidence ?? null,
});

/**
 * (args, deps?) => list|replay result; sub = args._[0] (default list). `deps` {appUp, doors, db}
 * exists for tests; the CLI passes none.
 */
export async function cmdOutbox({ _ = [], flags = {} } = {}, deps = {}) {
  const sub = _[0] ?? 'list';
  const slugs = slugsOf(flags);
  const entries = slugs.flatMap((s) => loadOutbox(s));
  if (sub === 'list') {
    const counts = Object.fromEntries(OUTBOX_STATES.map((st) => [st, entries.filter((e) => e.state === st).length]));
    return { counts, entries: entries.map(summary) };
  }
  if (sub !== 'replay') throw new Error(`outbox: unknown subcommand ${sub} (list|replay)`);

  const pending = entries.filter((e) => REPLAYABLE.includes(e.state));
  const dryRun = !!flags['dry-run'];
  if (!pending.length) return { dryRun, replayed: 0, entries: [] };
  if (!dryRun && !(await (deps.appUp ?? bridge.appUp)())) {
    throw new Refusal('app is not running', { queued: pending.filter((e) => e.state === 'queued').length, failed: pending.filter((e) => e.state === 'failed').length });
  }
  let db = deps.db, own = false;
  if (!db) { try { db = openDb(); own = true; } catch (err) { if (!dryRun) throw err; db = null; } }
  const doors = deps.doors ?? defaultDoors();
  const out = [];
  try {
    // Each entry once per run: a failure is recorded and left for the next replay, never retried here.
    for (const e of pending) {
      if (dryRun) {
        const r = db ? await replayEntry(e, { dryRun: true, doors, db }) : res('queued', 'app DB unreadable: pre-check not run');
        out.push({ ...summary(e), wouldBe: r.state, evidence: r.evidence });
        continue;
      }
      const r = await replayEntry(e, { doors, db });
      const updated = updateOutbox(e.slug, e.id, { state: r.state, attempts: (e.attempts ?? 0) + 1, evidence: r.evidence, replayedAt: nowIso() });
      out.push(summary(updated));
    }
  } finally { if (own) db.close(); }
  const tally = (st) => out.filter((o) => (dryRun ? o.wouldBe : o.state) === st).length;
  return { dryRun, counts: Object.fromEntries(OUTBOX_STATES.map((st) => [st, tally(st)])), entries: out };
}
