// Renders the wake context doc (WP1): a PORT of the in-app render_decision_prompt
// (src-tauri/src/engine/subscription/attention_decide.rs ~2598, inputs from attention.rs
// build_decision_context_with_mode ~1948 and project_snapshot ~3182) for the sections that have
// an input here. Dropped on purpose, because nothing headless feeds them: hire, resourceProfiles,
// the codex maintenance lane, council, the fleet registry, peers and workspace sections.
//
// Reads the app DB read-only and the local journal; writes ONLY contextDir(slug)/<wakeId>.md and
// one `status:"context"` wake line. Never inlines a repo's CLAUDE.md/AGENTS.md (kp's is 23KB).

import fs from 'node:fs';
import path from 'node:path';
import {
  ASK_KINDS, GLOBAL_CAP, MAX_ASKS, MAX_DISPATCH, MEM, PER_PROJECT_CAP, WAKE_MAX, WAKE_MIN,
  LIVE_RUN_STATES, contextDir, briefPath, mintId, nowIso, shortId,
} from './contract.mjs';
import { loadBrief, loadWakes, saveWake, openAsks, loadAsks, loadChannel, listRuns } from './store.mjs';
import {
  openDb, resolveProject, masterPersona, chartersFor, projectSnapshot, pendingReviews,
  operatorChannelSince, repoDocs,
} from './dbread.mjs';
import { brakes, parseTs, ageText, lastDecided, isDue } from './brakes.mjs';
import { queueTable } from './queue.mjs';
import { briefRepos, laneFor } from './repos.mjs';

export { parseTs, ageText, lastDecided, isDue };

export const MAX_CONTEXT_CHARS = 12000;
const UNOBSERVED_GAP_MIN = 240;   // attention_decide.rs UNOBSERVED_GAP_MINUTES

// ---------------------------------------------------------------- small pure helpers

const stampAge = (s, nowMs) => (s ? `${s}${ageText(s, nowMs) ? ` (${ageText(s, nowMs)})` : ''}` : 'never');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
const more = (total, shown, indent = '    ') => (total > shown ? [`${indent}+${total - shown} more`] : []);
const pathsText = (paths) => (Array.isArray(paths) && paths.length ? paths.join(', ') : 'none declared (the whole repo)');
/** Builder slots still free in this project and in all, from the running counts. */
export const freeSlots = (running = {}) => ({
  project: Math.max(0, PER_PROJECT_CAP - (running.project ?? 0)),
  global: Math.max(0, GLOBAL_CAP - (running.global ?? 0)),
});
const askForText = (a) => (Array.isArray(a) ? a.join('; ') : a) || 'a scope change, spending, risk on the money or data path, a conflict between two goals';

// ---------------------------------------------------------------- the renderer (pure)

/** List caps per budget level; renderContext steps down a level until the doc fits MAX_CONTEXT_CHARS. */
export const BUDGET_LEVELS = [
  { brief: 400, need: 160, core: 200, note: 260, goals: 10, ideas: 8, pending: 6, branches: 6, kpiNames: 5, asks: 6, said: 5, saidChars: 600, title: 120 },
  { brief: 300, need: 0, core: 200, note: 220, goals: 8, ideas: 6, pending: 5, branches: 5, kpiNames: 3, asks: 5, said: 4, saidChars: 500, title: 100 },
  { brief: 200, need: 0, core: 150, note: 160, goals: 5, ideas: 4, pending: 3, branches: 3, kpiNames: 0, asks: 4, said: 3, saidChars: 400, title: 76 },
  { brief: 110, need: 0, core: 0, note: 120, goals: 3, ideas: 3, pending: 2, branches: 2, kpiNames: 0, asks: 3, said: 2, saidChars: 220, title: 80 },
];
/** '2026-09-25T07:54:33.126043600+00:00' -> '2026-09-25 07:54Z' (the age beside it carries the rest). */
const shortStamp = (s) => { const t = parseTs(s); return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z` : String(s); };
const stampAgeShort = (s, nowMs) => (s ? `${shortStamp(s)}${ageText(s, nowMs) ? ` (${ageText(s, nowMs)})` : ''}` : 'never');

/**
 * (input) => string. Pure: everything it prints arrives in `input`. Steps down BUDGET_LEVELS until
 * the doc is under MAX_CONTEXT_CHARS (lists end in a "+N more" line when cut).
 * @param {Object} input {wakeId, now, project, master, brief, lastWake, charters[], asks{open,appPending,answered},
 *   channel{journal,app}, runs{live,recent}, snapshot, machine{memory,limit,running}, docs[]}
 */
export function renderContext(input) {
  let text = '';
  for (const caps of BUDGET_LEVELS) { text = renderAt(input, caps); if (text.length <= MAX_CONTEXT_CHARS) break; }
  return text;
}

/** One rendering at fixed caps (exported for measuring the levels). */
export function renderAt(input, C) {
  const { wakeId, now, project: p, master, brief = {}, lastWake, charters = [], asks = {}, channel = {},
    runs = {}, snapshot: s = {}, machine = {}, docs = [] } = input;
  const nowMs = parseTs(now);
  const L = [];
  const head = (h) => { L.push(''); L.push(h); };

  // identity + the standing question
  L.push(`You are the App Master of ${p.name} (slug ${p.slug}); this is your wake ${wakeId}. You hold standing responsibilities (charters) over this project. You run HEADLESS: the Personas app is closed, this document is your whole view, and your answer is one JSON object a terminal session carries out.`);
  L.push('');
  L.push('YOUR STANDING QUESTION: which of my responsibilities moves this project forward this wake, and why?');
  if (!master) L.push('\nThis project has no App Master persona in the app: no charter carries in-app coverage memory, and nothing you ask or say reaches the app until one is adopted. Decide from the brief and the journal.');

  head("OWNER'S BRIEF");
  if (brief.product) L.push(`- product: ${clip(brief.product, C.brief)}`);
  if (brief.stage) L.push(`- stage: ${clip(brief.stage, C.brief / 2)}`);
  if (brief.operatorRole) L.push(`- the operator is: ${clip(brief.operatorRole, C.brief / 2)}`);
  const kg = brief.goals ?? [];
  if (kg.length) { L.push('- key goals, in priority order:'); kg.slice(0, 5).forEach((g, i) => L.push(`  ${i + 1}. ${clip(g.title, C.title)}${g.measure ? ` (measured by: ${clip(g.measure, C.brief / 2)})` : ''}`)); L.push(...more(kg.length, 5, '  ')); }
  if (brief.boundaries?.length) { L.push('- boundaries (no builder may cross these):'); brief.boundaries.forEach((b) => L.push(`  - ${clip(b, C.brief / 2)}`)); }
  if (brief.reportStyle || brief.tone) L.push(`- report style: ${clip(brief.reportStyle || brief.tone, 160)}`);
  const repos = input.repos ?? [];
  if (repos.length) {
    L.push('- repos besides this project\'s own (`self`) that a dispatch may target with `repo`:');
    for (const r of repos) L.push(`  - ${r.key}: ${r.root} (base ${r.baseBranch}${r.lane != null ? `; at most ${r.lane} live run(s) there across ALL projects` : ''})`);
  }
  L.push(`- repo docs by path (read before writing a builder brief; not inlined): ${docs.length ? docs.join(' ; ') : 'none at the root'}`);

  // RIGHT NOW
  head(`RIGHT NOW (UTC): ${now}`);
  if (lastWake) {
    L.push(`Your last decided wake was ${stampAgeShort(lastWake.at, nowMs)}.`);
    if (Number.isFinite(lastWake.nextWakeMinutes)) L.push(`You chose to sleep ${lastWake.nextWakeMinutes} minutes after it.`);
    if ((nowMs - parseTs(lastWake.at)) / 60000 >= UNOBSERVED_GAP_MIN) L.push('That is a long gap: treat the interval behind you as UNOBSERVED rather than quiet.');
    if (lastWake.note) L.push(`Your note from last wake, in your own words: "${clip(lastWake.note, 600)}"`);
  } else {
    L.push('This is your first headless wake: the journal holds no earlier decision.');
  }

  // HOW TO DECIDE
  head('HOW TO DECIDE');
  L.push('- PRIORITY: an explicit priority (1 highest .. 5 lowest) goes ahead of none. No priority is not low priority: the judgment is yours.');
  L.push('- COVERAGE: the coverage and last-run lines and your last note are your memory. Do not re-run what you just ran; do not starve what you keep deferring.');
  const slots = freeSlots(machine.running);
  L.push(`- CAPACITY: dispatch AT MOST ${MAX_DISPATCH} charters (${PER_PROJECT_CAP} builders per project, ${GLOBAL_CAP} in all; running now: ${machine.running?.project ?? 0} here, ${machine.running?.global ?? 0} in all; free slots: ${slots.project} here, ${slots.global} in all). Two at once ONLY when each is independent of the other and their \`paths\` are disjoint from each other AND from every run in flight below. Every dispatch declares \`paths\`: the repo-relative prefixes or globs its builder will touch (none = the whole repo, which leaves no room for a second builder). An overlap is refused. None is a legitimate answer.`);
  if (repos.length) L.push(`- REPOS: \`repo\` (omit for self, or one of: ${repos.map((r) => r.key).join(', ')}) picks the repo a builder works and merges in. In a shared repo, paths must be disjoint from every OTHER project's runs there too, and its lane caps live runs across all projects; a dispatch that does not fit is queued, not lost.`);
  L.push('- MODEL: per dispatch, `model` "opus" for discovery (security scan, architecture review, KPI or measure design), "sonnet" for fixing a shape already chosen, delivering a well-specified idea, or a mechanical sweep; omit it for the charter default. A model the brief pins wins.');
  L.push(`- MACHINE: a dispatch is refused while FREE memory is under ${MEM.dispatchMinFreeGb} GB (+${MEM.perBuilderReserveGb} GB per builder already running) and while a usage-limit mark stands. A tripped memory brake clears by itself within minutes: dispatch nothing this wake and choose a SHORT next wake (10 to 20 min); a usage limit needs a long one.`);
  L.push('- IN FLIGHT: running, exited and verifying runs are not finished; planned is minted, not started. A QUEUED run (a dispatch refused for a slot, held and started in order when one frees) is a promise the loop keeps. Never re-dispatch a live or queued charter, or an idea an in-flight or queued task carries.');
  L.push('- THE BUILDER: a fresh builder in an isolated worktree on its own autopilot branch, merged only if the gates pass and no file it touched is dirty in the checkout. Your `brief` is all it knows: what to change, the accepted idea ids it carries (up to 6 of one shape, or none), how it proves done. A delivery brief first checks each id against the base branch; one already there is closed as delivered, not rebuilt.');
  L.push('- IDEA VERDICTS: accept or reject a pending idea named here, with a reason; queued until the app is up.');
  L.push(`- NEXT WAKE: \`nextWakeMinutes\`, integer ${WAKE_MIN}-${WAKE_MAX}, always present. SHORT (${WAKE_MIN}-20) after a dispatch to check on or with work you could not start; LONG (60-${WAKE_MAX}) when all is in flight, nothing is due, or a brake is tripped.`);
  L.push(`- ASK WHEN BLOCKED: ask when only the operator can take the decision that moves the project; ask only about: ${clip(askForText(brief.askFor), 300)}. Never ask what you can decide, never repeat an open ask. At most ${MAX_ASKS}; \`kind\` one of ${ASK_KINDS.join(', ')}; 2-4 options, each a label plus the action you take if chosen.`);
  L.push('- ANSWER THE OPERATOR: what the operator said is an instruction to reflect in this plan and to answer in `say`; an answered ask naming an action is yours to carry out THIS wake.');
  L.push('- EVERY charter appears exactly once, in `dispatch` or `defer`. A deferral with a reason is a decision; silence is not.');

  // ALREADY WITH THE OPERATOR (always rendered: zero open asks is a fact to be told in words)
  head('ALREADY WITH THE OPERATOR (do not ask these again)');
  const open = asks.open ?? [], appPending = asks.appPending ?? [];
  if (!open.length && !appPending.length) L.push('- none open: nothing you asked is waiting on the operator');
  for (const a of open.slice(0, C.asks)) L.push(`- [${a.kind}] ${clip(a.question, 220)} (raised ${stampAgeShort(a.raisedAt, nowMs)}${a.source === 'merge-gate' ? ', by the merge gate' : ''})`);
  L.push(...more(open.length, C.asks, '  '));
  for (const r of appPending.slice(0, C.asks)) L.push(`- [in the app] ${clip(r.title, 220)} (${stampAgeShort(r.created_at, nowMs)})`);
  L.push(...more(appPending.length, C.asks, '  '));

  const answered = asks.answered ?? [];
  if (answered.length) {
    head('ANSWERED SINCE YOUR LAST WAKE');
    for (const a of answered.slice(0, C.asks)) {
      L.push(`- ${clip(a.question, 200)}`);
      L.push(`    chosen: ${clip(a.answer?.choice, 120)}${a.answer?.notes ? ` - notes: ${clip(a.answer.notes, 300)}` : ''}`);
    }
    L.push(...more(answered.length, C.asks, '  '));
    L.push('An answer that names an action is yours to carry out this wake; nothing else will. A rejection is a constraint, not a failure: do not re-raise it.');
  }

  const said = [...(channel.journal ?? []).map((c) => ({ at: c.at, body: c.message, where: 'terminal' })),
    ...(channel.app ?? []).map((c) => ({ at: c.created_at, body: c.body, where: 'app channel' }))]
    .sort((a, b) => parseTs(b.at) - parseTs(a.at));
  if (said.length) {
    head('WHAT THE OPERATOR SAID (newest first)');
    for (const c of said.slice(0, C.said)) { L.push(`- ${stampAgeShort(c.at, nowMs)}, ${c.where}:`); L.push(`    ${clip(c.body, C.saidChars)}`); }
    L.push(...more(said.length, C.said, '  '));
  }

  // YOUR CHARTERS (an in-app note shared by several charters is printed once)
  head('YOUR CHARTERS');
  if (!charters.length) L.push('(none in the brief: dispatch nothing)');
  const firstWithNote = new Map();
  for (const c of charters) {
    L.push(`- slug: ${c.slug} · priority ${c.priority ?? 'none declared (your judgment)'}`);
    L.push(`  title: ${clip(c.title, C.title)}${c.dbStatus && c.dbStatus !== 'active' ? ` (in-app status: ${c.dbStatus})` : ''} · text from ${c.source}${c.model ? ` · builder model ${c.model}` : ''}`);
    if (c.need && C.need) L.push(`  need: ${clip(c.need, C.need)}`);
    if (c.coreAction && C.core) L.push(`  core action: ${clip(c.coreAction, C.core)}`);
    if (c.lastDecidedAt || c.lastDispatchedAt) L.push(`  in-app: decided ${stampAgeShort(c.lastDecidedAt, nowMs)}, dispatched ${stampAgeShort(c.lastDispatchedAt, nowMs)}`);
    if (c.pacingNote) {
      const seen = firstWithNote.get(c.pacingNote);
      if (seen) L.push(`  in-app note: the same as ${seen}'s`);
      else { firstWithNote.set(c.pacingNote, c.slug); L.push(`  in-app note: "${clip(c.pacingNote, C.note)}"`); }
    }
    const r = c.lastRun;
    L.push(`  headless: ${c.lastHeadless ? `${c.lastHeadless.verb} - ${clip(c.lastHeadless.reason, 200)}` : 'never decided on'} · last run: ${r ? `${shortId(r.runId)} ${r.state}, created ${stampAgeShort(r.createdAt, nowMs)}${r.mergedSha ? `, merged ${String(r.mergedSha).slice(0, 8)}` : ''}${r.heldReason ? `, held: ${clip(r.heldReason, 160)}` : ''}` : 'none'}`);
  }

  // PROJECT STATE
  head('PROJECT STATE');
  const co = s.checkout ?? {};
  L.push(`- ${p.name} (${p.id}) at ${p.root}`);
  L.push(`  base branch: ${p.baseBranch}${p.baseBranchNote ? ` (${p.baseBranchNote})` : ''}; the checkout is on ${co.branch ?? 'unknown'} with ${co.dirty ?? 'unknown'} uncommitted path(s); a merge is refused on any file the branch touches that is dirty here`);
  const goals = s.goals ?? [];
  const openGoals = goals.filter((g) => g.status !== 'done'), doneGoals = goals.length - openGoals.length;
  if (!goals.length) L.push('  goals: 0 set on this project (none set)');
  else {
    L.push(`  goals (${openGoals.length} open, ${doneGoals} done):`);
    for (const g of openGoals.slice(0, C.goals)) {
      const work = g.ideas || g.tasks ? `${g.ideas} idea(s), ${g.tasks} task(s), ${g.completed_tasks} completed` : 'no work attached';
      L.push(`    - [${String(g.id).slice(0, 8)}] ${clip(g.title, C.title)} - ${g.status}${g.progress != null ? ` ${g.progress}%` : ''} · ${work}`);
    }
    L.push(...more(openGoals.length, C.goals));
  }
  const ant = s.acceptedNoTask ?? { count: 0, oldest: [] };
  L.push(`  accepted ideas with no task: ${ant.count} · pending ideas: ${s.pendingCount ?? 0} (unrated: ${s.unratedCount ?? 0})`);
  const oldest = (ant.oldest ?? []).slice(0, C.ideas);
  if (oldest.length) {
    L.push(`  oldest accepted with no task (${oldest.length} of ${ant.count}):`);
    for (const i of oldest) L.push(`    - ${i.id}: ${clip(i.title, C.title)}`);
    L.push('  The order is YOURS: group and drain this backlog by your own judgement of effort, impact and risk; do not ask which to take next.');
  }
  const pend = (s.pendingSample ?? []).slice(0, C.pending);
  if (pend.length) {
    L.push(`  pending ideas a verdict may name (${pend.length} of ${s.pendingCount ?? pend.length}, highest impact for least effort; e/i/r = effort/impact/risk):`);
    for (const i of pend) L.push(`    - ${i.id}: ${clip(i.title, C.title)} (${i.effort ?? '-'}/${i.impact ?? '-'}/${i.risk ?? '-'})`);
  }
  if (s.unratedCount) L.push('  Unrated pending ideas are never auto-accepted; a builder that touches one re-files it with effort, impact and risk (1-5).');
  const k = s.kpis ?? {};
  const kn = (k.unmeasuredNames ?? []).slice(0, C.kpiNames);
  L.push(`  KPIs: ${k.active ?? 0} active, ${k.unmeasured ?? 0} never measured${kn.length ? `, e.g. ${kn.map((n) => clip(n, 60)).join('; ')}` : ''}`);
  const tasks = s.inFlightTasks ?? [];
  if (!tasks.length) L.push('  in-app tasks in flight: nothing');
  else { L.push(`  in-app tasks in flight (${tasks.length}; DO NOT RE-DISPATCH these):`); for (const t of tasks) L.push(`    - ${clip(t.title, C.title)}${t.source_idea_id ? ` [idea ${t.source_idea_id}]` : ''} (${t.status}${t.started_at ? `, started ${shortStamp(t.started_at)}` : ''})`); }
  const live = runs.live ?? [], recent = runs.recent ?? [];
  const qd = input.queue ?? { mine: [], total: 0 };
  const queuedAt = new Map((qd.mine ?? []).map((q) => [q.runId, q]));
  if (!live.length) L.push('  headless runs in flight: nothing');
  else {
    L.push('  headless runs in flight (a new dispatch must not overlap their paths):');
    for (const r of live) {
      const q = queuedAt.get(r.runId);
      L.push(`    - ${shortId(r.runId)} ${r.charterSlug} ${r.state}${q ? `, QUEUED at position ${q.position} of ${qd.total} (waiting ${q.waitedMin ?? '?'} min on ${q.reason})` : ''}${r.model ? ` (${r.model})` : ''}${r.repo && r.repo !== 'self' ? ` in repo ${r.repo}` : ''}${r.branch ? ` on ${r.branch}` : ''} (created ${stampAgeShort(r.createdAt, nowMs)}); paths: ${clip(pathsText(r.paths), 200)}`);
    }
  }
  if (recent.length) { L.push('  recent headless runs:'); for (const r of recent) L.push(`    - ${shortId(r.runId)} ${r.charterSlug} ${r.state}${r.mergedSha ? ` ${String(r.mergedSha).slice(0, 8)}` : ''}${r.heldReason ? `: ${clip(r.heldReason, 140)}` : ''}`); }
  const gb = s.gitBranches ?? { total: 0, branches: [] };
  if (gb.error) L.push(`  unmerged autopilot branches: not read (${clip(gb.error, 160)})`);
  else if (!gb.total) L.push('  unmerged autopilot branches: none');
  else {
    const shown = gb.branches.slice(0, C.branches);
    L.push(`  AWAITING A MERGE (${gb.total} unmerged autopilot branch(es), newest first):`);
    for (const b of shown) L.push(`    - ${b.branch}: ${b.ahead ?? '?'} ahead, ${b.behind ?? '?'} behind${b.at ? `, tip ${String(b.at).slice(0, 10)}` : ''}`);
    L.push(...more(gb.total, shown.length));
    L.push('  Reconcile a branch before cutting another beside it for the same charter; raise ONE ask naming them if none about them is open.');
  }
  if (s.readErrors?.length) L.push(`  app DB reads that failed (those figures are unknown, not zero): ${s.readErrors.map((e) => clip(e, 100)).join('; ')}`);

  // MACHINE
  head('MACHINE');
  const mem = machine.memory ?? {}, lim = machine.limit ?? {}, run = machine.running ?? {};
  L.push(`- memory: ${mem.freeGb ?? '?'} GB free${mem.totalGb != null ? ` of ${mem.totalGb}` : ''}; a dispatch needs ${mem.dispatchNeedGb ?? MEM.dispatchMinFreeGb} GB free${mem.stop ? ' - TRIPPED NOW' : ''}`);
  L.push(`- usage limit: ${lim.limited ? `LIMITED${lim.reason ? ` (${clip(lim.reason, 120)})` : ''}${lim.resetsAt ? `, resets ${lim.resetsAt}` : ', reset time unknown'} - dispatch is refused` : 'none'}`);
  const free = freeSlots(run);
  L.push(`- running builders: ${run.project ?? 0} of ${PER_PROJECT_CAP} in this project (${free.project} slot(s) free), ${run.global ?? 0} of ${GLOBAL_CAP} across all projects (${free.global} free)`);
  L.push(`- admission queue: ${qd.total ?? 0} run(s) waiting across all projects, ${(qd.mine ?? []).length} of them yours; a refused dispatch queues and starts in order when a slot frees`);

  // OUTPUT CONTRACT (schema/decision.schema.json)
  head('ANSWER WITH ONE JSON OBJECT AND NOTHING ELSE - no prose before or after, no code fence:');
  L.push(`{"wakeId":"${wakeId}","dispatch":[{"charterSlug":"<slug>","reason":"<why this one now>","brief":"<the builder's whole task>","ideaIds":["<accepted idea id>"],"model":"sonnet|opus","paths":["<repo-relative path prefix or glob it will touch>"]}],"defer":[{"charterSlug":"<slug>","reason":"<why it waits>"}],"asks":[{"kind":"<kind>","question":"<the decision you need>","context":"<why the loop needs it>","options":[{"label":"<a choice>","action":"<what you do if chosen>"}]}],"ideaVerdicts":[{"ideaId":"<pending idea id>","status":"accepted|rejected","reason":"<why>"}],"say":"<message to the operator>|null","note":"<coverage note for your next wake>","nextWakeMinutes":<${WAKE_MIN}-${WAKE_MAX}>}`);
  L.push(`Every key is always present ([] when empty, say null when silent). wakeId is exactly "${wakeId}"; every charter slug exactly once across dispatch and defer, no other slug; dispatch at most ${MAX_DISPATCH}, and with two each carries non-empty disjoint paths and no idea in both; model optional${repos.length ? `; repo optional (self, ${repos.map((r) => r.key).join(', ')})` : ''}; asks at most ${MAX_ASKS}, 2-4 options each, kind one of ${ASK_KINDS.join(', ')}; nextWakeMinutes an integer; every ideaId copied from this document.`);
  L.push(`Charter slugs: ${charters.map((c) => c.slug).join(', ') || '(none)'}`);
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- gathering

/** The headless memory of each charter: the last decided wake's verb + reason, the last run. */
function headlessCoverage(charters, wakes, runs) {
  const decided = wakes.filter((w) => w.status === 'decided' && w.decision).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return charters.map((c) => {
    let lastHeadless = null;
    for (const w of decided) {
      const d = w.decision.dispatch?.find((x) => x.charterSlug === c.slug);
      const f = w.decision.defer?.find((x) => x.charterSlug === c.slug);
      if (d) lastHeadless = { verb: `dispatched ${w.at}`, reason: d.reason };
      else if (f) lastHeadless = { verb: `deferred ${w.at}`, reason: f.reason };
    }
    const lastRun = runs.filter((r) => r.charterSlug === c.slug).at(-1) ?? null;
    return { ...c, lastHeadless, lastRun };
  });
}

/** Everything renderContext needs for one project, read now (DB read-only + journal). Writes nothing. */
export function gatherContext(ref) {
  const d = openDb();
  let project, input;
  try {
    project = resolveProject(ref, d);
    const brief = loadBrief(project.slug);
    if (!brief) throw new Error(`no brief for ${project.slug} at ${briefPath(project.slug)}: run onboard first (appmaster.mjs onboard --project ${project.slug} --brief <file.json>)`);
    const now = nowIso(), nowMs = Date.parse(now);
    const wakes = loadWakes(project.slug);
    const last = lastDecided(wakes);
    const since = last?.at ?? new Date(nowMs - 72 * 3600e3).toISOString();
    const master = masterPersona(d, project.id);
    const runs = listRuns(project.slug);
    const models = brief.models ?? {};
    const charters = headlessCoverage(chartersFor(d, project.id, brief), wakes, runs)
      .map((c) => ({ ...c, model: models.byCharter?.[c.slug] ?? null }));
    const b = brakes(project.slug);
    input = {
      wakeId: mintId(), now, project, master, brief,
      lastWake: last ? { at: last.at, nextWakeMinutes: last.decision?.nextWakeMinutes, note: last.note ?? last.decision?.note } : null,
      charters,
      asks: {
        open: openAsks(project.slug),
        appPending: pendingReviews(d, master?.id),
        answered: loadAsks(project.slug).filter((a) => a.state === 'answered' && (!last || String(a.answer?.at) > last.at)),
      },
      channel: {
        journal: loadChannel(project.slug).filter((c) => c.from === 'operator' && c.at > since),
        app: operatorChannelSince(d, master?.id, since),
      },
      runs: {
        live: runs.filter((r) => LIVE_RUN_STATES.includes(r.state)),
        recent: runs.filter((r) => !LIVE_RUN_STATES.includes(r.state)).slice(-5),
      },
      snapshot: projectSnapshot(d, project),
      machine: b,
      docs: repoDocs(project.root),
    };
    const table = queueTable(nowMs);
    input.queue = { mine: table.filter((q) => q.slug === project.slug), total: table.length };
    input.repos = briefRepos(brief).map((r) => ({ key: r.key, root: r.root, baseBranch: r.baseBranch, lane: laneFor(r.root) }));
    input.due = isDue(wakes, nowMs);
  } finally { d.close(); }
  return input;
}

/** (args) => {wakeId, path, slug, due, brakes:{memory,limit,running}}   // writes the doc + a status:"context" wake line */
export async function cmdContext({ flags = {} } = {}) {
  const input = gatherContext(flags.project);
  const project = input.project;

  const text = renderContext(input);
  const file = path.join(contextDir(project.slug), `${input.wakeId}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  saveWake(project.slug, { wakeId: input.wakeId, slug: project.slug, at: input.now, contextPath: file, status: 'context', project, due: input.due, chars: text.length });
  const m = input.machine;
  return {
    wakeId: input.wakeId, path: file, slug: project.slug, due: input.due, chars: text.length,
    brakes: {
      memory: { freeGb: m.memory.freeGb, usedPct: m.memory.usedPct, needGb: m.memory.dispatchNeedGb, stop: m.memory.stop },
      limit: { limited: m.limit.limited, resetsAt: m.limit.resetsAt },
      running: { project: m.running.project, global: m.running.global, free: freeSlots(m.running) },
    },
  };
}
