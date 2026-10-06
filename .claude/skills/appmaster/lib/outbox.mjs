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
//   plan          -> POST /dev-tools/milestones {projectId, name, goal?, description?, targetDate?} -> {milestoneId}
//                    per milestone, then POST /dev-tools/goals {projectId, title, description?, targetDate?,
//                    milestoneId} -> {goalId} per goal. Every id is recorded in the entry's `created` and
//                    never posted again. Until a route answers, a 404 leaves the entry queued with the
//                    evidence "route missing (404)" (those routes are new on 2026-10-07).
//   council       -> POST /dev-tools/council/ingest {projectId, runDir} (runDir: the journal's durable copy)
//   tier          -> GET /dev-tools/use-cases/{projectId} (the id by slug), then
//                    POST /dev-tools/use-cases/{useCaseId}/tier {tier}
//   report        -> POST /dev-tools/reports {projectId, title, content, attachments, approval}
//                    (a FULL council `ready`: the human gate. The council never approves.)
//                    The same 404 rule holds for all three.

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

/**
 * A door whose ROUTE is missing (not built yet, or not in this build): an unrouted path answers axum's
 * EMPTY 404. Not a failure of the entry: it stays queued. A handler's own 404 carries a reason in its
 * body ("No project registered with id ...", measured on the 2026-10-07 milestones/goals doors) and is
 * a real failure the operator must see. Without a body to look at (a test door), any 404 counts.
 */
export const is404 = (err) => {
  const status = err?.status ?? (/->\s*404\b/.test(String(err?.message ?? err ?? '')) ? 404 : null);
  if (status !== 404) return false;
  return typeof err?.body === 'string' ? !err.body.trim() : true;
};
const firstLine = (err) => String(err?.message || err).split('\n')[0].slice(0, 240);

/** The goal's text for the app: its description, then its measure (the goals door has no measure field). */
export const goalDescription = (g) => [g.description, g.measure ? `Measure: ${g.measure}` : null].filter((s) => typeof s === 'string' && s.trim()).join('\n\n');

/**
 * plan {projectId, plan}: milestones first (each needs its id for its goals), then goals. Idempotent
 * three ways: an id in `created` is never posted again; before a post, a milestone of the same name in
 * the project (or a goal of the same title linked to that milestone) is adopted instead (a crash between
 * the post and the journal line); after the posts, every created id must read back from the DB.
 * Progress is returned in `created` on EVERY outcome, so a failure halfway is resumed, not repeated.
 */
async function plan(e, { db, doors, dryRun }) {
  const { projectId, plan: p } = e.payload;
  const ms = Array.isArray(p?.milestones) ? p.milestones : [];
  const created = { milestones: { ...(e.created?.milestones ?? {}) }, goals: { ...(e.created?.goals ?? {}) } };
  const done = (state, evidence) => res(state, evidence, { created });
  const ids8 = (o) => Object.values(o).map(id8).join(', ');
  let posted = 0, adopted = 0, wouldPost = 0;
  const post = async (route, body, what) => {
    if (typeof doors.devTools !== 'function') return { stop: res('skipped', 'no door: doors.devTools is absent', { created }) };
    try { return { answer: await doors.devTools(route, body) }; } catch (err) {
      return { stop: is404(err)
        ? done('queued', `route missing (404): POST /dev-tools${route} (${posted} posted before it)`)
        : done('failed', `door error on ${what}: ${firstLine(err)}`) };
    }
  };
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const goals = Array.isArray(m.goals) ? m.goals : [];
    let mid = created.milestones[i] ?? null;
    if (!mid) {
      mid = one(db, 'select id from dev_milestones where project_id = ? and name = ?', [projectId, m.name])?.id ?? null;
      if (mid) { created.milestones[i] = mid; adopted++; }
    }
    if (!mid) {
      if (dryRun) { wouldPost += 1 + goals.length; continue; }
      const r = await post('/milestones', { projectId, name: m.name, ...(m.goal ? { goal: m.goal } : {}), ...(m.targetDate ? { targetDate: m.targetDate } : {}) }, `milestone ${i + 1}`);
      if (r.stop) return r.stop;
      mid = r.answer?.milestoneId ?? r.answer?.id ?? null;
      if (!mid) return done('failed', `the milestones door answered without a milestoneId for milestone ${i + 1}`);
      created.milestones[i] = mid; posted++;
    }
    for (let k = 0; k < goals.length; k++) {
      const g = goals[k], key = `${i}.${k}`;
      if (created.goals[key]) continue;
      const found = one(db, `select g.id from dev_goals g join dev_milestone_items mi on mi.item_id = g.id and mi.item_kind = 'goal'
                             where mi.milestone_id = ? and g.title = ?`, [mid, g.title])?.id ?? null;
      if (found) { created.goals[key] = found; adopted++; continue; }
      if (dryRun) { wouldPost++; continue; }
      const description = goalDescription(g);
      const r = await post('/goals', { projectId, title: g.title, ...(description ? { description } : {}), milestoneId: mid }, `goal ${key}`);
      if (r.stop) return r.stop;
      const gid = r.answer?.goalId ?? r.answer?.id ?? null;
      if (!gid) return done('failed', `the goals door answered without a goalId for goal ${key}`);
      created.goals[key] = gid; posted++;
    }
  }
  if (dryRun) return done('queued', wouldPost ? `would POST ${wouldPost} milestone/goal row(s) through /dev-tools/milestones and /dev-tools/goals` : 'nothing left to post');
  const missing = [
    ...Object.values(created.milestones).filter((id) => !one(db, 'select id from dev_milestones where id = ?', [id])),
    ...Object.values(created.goals).filter((id) => !one(db, 'select id from dev_goals where id = ?', [id])),
  ];
  if (missing.length) return done('failed', `post-check: ${missing.length} created id(s) not in the app DB: ${missing.map(id8).join(', ')}`);
  return done('replayed', `db: ${Object.keys(created.milestones).length} milestone(s) [${ids8(created.milestones)}] and ${Object.keys(created.goals).length} goal(s) [${ids8(created.goals)}] (${posted} posted now, ${adopted} found already there)`);
}

/** POST through the bridge; a 404 becomes {missing}, any other failure throws (replayEntry: failed). */
async function postOr404(doors, route, body) {
  if (typeof doors.devTools !== 'function') return { absent: true };
  try { return { answer: await doors.devTools(route, body) }; } catch (err) { if (is404(err)) return { missing: true }; throw err; }
}
const baseName = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '';

/** council {projectId, runDir, featureSlug, mode, outcome}: the app ingests the durable copy of the run directory. */
async function council(e, { db, doors, dryRun }) {
  const { projectId, runDir, featureSlug, mode, outcome } = e.payload;
  const name = baseName(runDir);
  const read = () => one(db, 'select id from dev_council_runs where run_dir = ? or run_dir like ?', [runDir, `%${name}`]);
  const before = read();
  if (before) return res('skipped', `already applied: council run ${id8(before.id)} holds ${name}`);
  if (dryRun) return res('queued', `would POST /dev-tools/council/ingest (${mode} ${featureSlug}: ${outcome}, ${name})`);
  const r = await postOr404(doors, '/council/ingest', { projectId, runDir });
  if (r.absent) return res('skipped', 'no door: doors.devTools is absent');
  if (r.missing) return res('queued', 'route missing (404): POST /dev-tools/council/ingest');
  const after = read();
  return after
    ? res('replayed', `db: council run ${id8(after.id)} (${mode} ${featureSlug}: ${outcome})`)
    : res('failed', `post-check: no dev_council_runs row for ${name} after the door answered`);
}

/** tier {projectId, featureSlug, tier}: a full council's `ready` marks the feature major. */
async function tier(e, { db, doors, dryRun }) {
  const { projectId, featureSlug, tier: want } = e.payload;
  const row = () => one(db, 'select id, tier from dev_use_cases where project_id = ? and slug = ?', [projectId, featureSlug]);
  const before = row();
  if (!before) return res('skipped', `no use case ${featureSlug} for this project in the app DB`);
  if (before.tier === want) return res('skipped', `already applied: ${featureSlug} is ${want}`);
  if (dryRun) return res('queued', `would resolve ${featureSlug} through GET /dev-tools/use-cases/${id8(projectId)} and POST its tier ${want}`);
  if (typeof doors.devTools !== 'function') return res('skipped', 'no door: doors.devTools is absent');
  let list;
  try { list = await doors.devTools(`/use-cases/${encodeURIComponent(projectId)}`); } catch (err) {
    if (is404(err)) return res('queued', 'route missing (404): GET /dev-tools/use-cases/{projectId}');
    throw err;
  }
  const rows = Array.isArray(list) ? list : (list?.useCases ?? list?.items ?? []);
  const useCaseId = rows.find((u) => u?.slug === featureSlug)?.id ?? null;
  if (!useCaseId) return res('failed', `GET /dev-tools/use-cases did not list ${featureSlug}`);
  const r = await postOr404(doors, `/use-cases/${encodeURIComponent(useCaseId)}/tier`, { tier: want });
  if (r.missing) return res('queued', 'route missing (404): POST /dev-tools/use-cases/{useCaseId}/tier');
  const after = row();
  return after?.tier === want
    ? res('replayed', `db: ${featureSlug} tier ${want}`)
    : res('failed', `post-check: ${featureSlug} tier is ${after?.tier ?? 'unset'} after the door answered`);
}

/**
 * report {projectId, title, content, attachments, approval}: the council's report and an Approval only
 * the operator answers. Once the door names a report id it is recorded (`created`) and never posted again.
 */
async function report(e, { db, doors, dryRun }) {
  const p = e.payload;
  const find = () => one(db, 'select id from persona_reports where title = ? order by created_at desc limit 1', [p.title]);
  const before = e.created?.reportId ? { id: e.created.reportId } : find();
  if (before) return res('skipped', `already applied: report ${id8(before.id)}`, { created: { reportId: before.id } });
  if (dryRun) return res('queued', `would POST /dev-tools/reports ("${String(p.title).slice(0, 80)}", ${p.attachments?.length ?? 0} attachment(s), approval "${p.approval?.title ?? ''}")`);
  const r = await postOr404(doors, '/reports', p);
  if (r.absent) return res('skipped', 'no door: doors.devTools is absent');
  if (r.missing) return res('queued', 'route missing (404): POST /dev-tools/reports');
  const after = find();
  if (after) return res('replayed', `db: report ${id8(after.id)}`, { created: { reportId: after.id } });
  const answered = r.answer?.reportId ?? r.answer?.id ?? null;
  return answered
    ? res('replayed', `the door answered report ${id8(answered)}; no persona_reports row has its title (the route may store it elsewhere)`, { created: { reportId: answered } })
    : res('failed', 'post-check: no report row and no report id after the door answered');
}

const HANDLERS = { 'idea-verdict': ideaVerdict, 'task-complete': taskComplete, ask, say, plan, council, tier, report };

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
      const updated = updateOutbox(e.slug, e.id, { state: r.state, attempts: (e.attempts ?? 0) + 1, evidence: r.evidence, replayedAt: nowIso(), ...(r.created ? { created: r.created } : {}) });
      out.push(summary(updated));
    }
  } finally { if (own) db.close(); }
  const tally = (st) => out.filter((o) => (dryRun ? o.wouldBe : o.state) === st).length;
  return { dryRun, counts: Object.fromEntries(OUTBOX_STATES.map((st) => [st, tally(st)])), entries: out };
}
