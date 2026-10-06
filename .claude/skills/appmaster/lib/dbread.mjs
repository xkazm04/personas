// Read-only app DB access for /appmaster (WP1). Every open here passes `readOnly: true`; a test
// greps lib/*.mjs for any other `new DatabaseSync(` and fails on it. This file must NEVER write the
// app database, and never shells out to anything but read-only git plumbing.
//
// The read helpers are an intentional COPY of .claude/skills/master/master.mjs (db/q/one/projects/
// resolveProject/masterOf/charters/goals/ideasSummary/kpisSummary/gitBranches, lines ~66-207):
// that file probes ports 17320-17325 and parses argv at import, so it cannot be imported
// (Director decision D7). The SQL for the snapshot is ported from the in-app sensors it mirrors:
// attention.rs `project_snapshot` (~3182), db repos dev/attention.rs `undispatched_ideas_rows`
// (~696), dev/ideas.rs `count_unrated_pending_ideas` (~558), dev/tasks.rs `list_in_flight_tasks`
// (~535), dev/goals.rs `goal_work_by_project` (~642).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, REPO_ROOT, slugOf, slugify } from './contract.mjs';
import { listSlugs, loadWakes } from './store.mjs';

export const TEMPLATE_DIR = path.join(REPO_ROOT, 'scripts', 'templates', '_app_master');
/** In-app caps (attention_decide.rs): goals 12, unmerged branches 10, in-flight tasks 10. */
export const SNAPSHOT_CAPS = { goals: 12, branches: 10, inFlight: 10, ideas: 8, kpis: 5 };
const ABANDONED_PREFIX = 'worker ended without write-back: ';   // dev/tasks.rs:246
const PLATFORM_SCAN_TYPE = 'platform_escalation';               // dev/ideas.rs:1896

const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

// ---------------------------------------------------------------- database (read-only)

const readErrors = new WeakMap();

/** () => DatabaseSync   // readOnly, busy_timeout */
export function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`app database not found at ${DB_PATH} (set PERSONAS_DB)`);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  d.exec('PRAGMA busy_timeout = 3000');
  readErrors.set(d, []);
  return d;
}

/** Rows, or [] when the read fails; the failure is kept (dbErrors) instead of posing as a row. */
export function q(d, sql, params = []) {
  try { return d.prepare(sql).all(...params).map((r) => ({ ...r })); } catch (e) {
    const list = readErrors.get(d) ?? []; list.push(String(e.message || e).split('\n')[0]); readErrors.set(d, list);
    return [];
  }
}
export const one = (d, sql, params = []) => q(d, sql, params)[0] ?? null;
/** Read failures seen on this handle (a missing table in an older DB, a locked file). */
export const dbErrors = (d) => [...new Set(readErrors.get(d) ?? [])];

/** (db) => Array<{id,name,root_path,main_branch,workspace_id}> */
export function listProjects(d) {
  return q(d, `select id, name, root_path, description, status, main_branch, workspace_id from dev_projects order by name`);
}

// ---------------------------------------------------------------- git (read-only)

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
const branchExists = (root, b) => { try { git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]); return true; } catch { return false; } };

/**
 * The base branch: dev_projects.main_branch, default 'master'. When the checkout has no such
 * branch (measured 2026-10-05: ascent's row says 'main', its only trunk is 'master') the branch
 * that exists wins and `baseBranchNote` says why, so a worktree is never cut from a phantom ref.
 */
export function baseBranchOf(row) {
  const declared = row.main_branch || 'master';
  const root = row.root_path;
  if (!root || !fs.existsSync(root) || branchExists(root, declared)) return { baseBranch: declared };
  const found = ['main', 'master'].find((b) => b !== declared && branchExists(root, b));
  if (!found) return { baseBranch: declared, baseBranchNote: `branch ${declared} does not exist in ${root}` };
  return { baseBranch: found, baseBranchNote: `dev_projects.main_branch is ${row.main_branch ?? 'null'}; the checkout has ${found}, not ${declared}` };
}

/** (ref: string, db?) => ProjectCtx   // id | name | root | slug; throws on no match */
export function resolveProject(ref, d) {
  if (!ref || ref === true) throw new Error('--project <id|name|root|slug> is required');
  const own = !d; if (own) d = openDb();
  try {
    const rows = listProjects(d);
    const r = String(ref);
    const hit = rows.find((p) => p.id === r)
      || rows.find((p) => p.name.toLowerCase() === r.toLowerCase())
      || rows.find((p) => norm(p.root_path) === norm(r))
      || rows.find((p) => slugOf(p.name, p.root_path) === slugify(r))
      || rows.find((p) => slugify(p.name) === slugify(r));
    if (!hit) throw new Error(`no dev_projects row matches "${ref}"`);
    const ctx = { slug: slugOf(hit.name, hit.root_path), id: hit.id, name: hit.name, root: hit.root_path, ...baseBranchOf(hit) };
    return ctx;
  } finally { if (own) d.close(); }
}

/**
 * A managed project without the DB when the journal already holds it: the brief's slug plus the
 * ProjectCtx the last `context` snapshotted into wakes.jsonl. Falls back to resolveProject.
 * @returns {{slug:string, project:import('./contract.mjs').ProjectCtx|null}}
 */
export function resolveManaged(ref) {
  if (!ref || ref === true) throw new Error('--project <id|name|root|slug> is required');
  const s = slugify(ref);
  if (listSlugs().includes(s)) {
    const known = loadWakes(s).filter((w) => w.project).at(-1)?.project;
    if (known) return { slug: s, project: known };
    try { const p = resolveProject(ref); return { slug: p.slug, project: p }; } catch { return { slug: s, project: null }; }
  }
  const p = resolveProject(ref);
  return { slug: p.slug, project: p };
}

// ---------------------------------------------------------------- the master and its charters

/** (db, projectId) => {id,name,enabled}|null */
export function masterPersona(d, projectId) {
  // The adoption door binds every charter to the project; the persona is the charters' owner.
  const m = one(d, `
    select p.id, p.name, p.enabled from personas p
    where p.id in (select persona_id from persona_responsibilities where project_id = ?)
      and p.name like 'App Master%'
    order by p.created_at desc limit 1`, [projectId]);
  return m ? { ...m, enabled: !!m.enabled } : null;
}

function parseSpec(s) { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } }
function readTemplate(slug) {
  try { return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, `${slug}.json`), 'utf8')); } catch { return null; }
}
/** brief.charters items may be a bare slug or {slug, priority}. */
export const briefCharters = (brief) => (brief?.charters ?? [])
  .map((c) => (typeof c === 'string' ? { slug: c, priority: null } : { slug: c?.slug, priority: c?.priority ?? null }))
  .filter((c) => c.slug);

/**
 * (db, projectId, brief) => Array<{slug,title,priority,need,coreAction,pacingNote,source:"db"|"template"|"slug-only"}>
 * The brief decides WHICH charters exist; their text comes from the master persona's
 * persona_responsibilities spec (description.need/coreAction, pacing.coverageNote, recipeRef.slug),
 * else scripts/templates/_app_master/<slug>.json, else the slug alone.
 */
export function chartersFor(d, projectId, brief) {
  const m = d && projectId ? masterPersona(d, projectId) : null;
  const rows = m ? q(d, `select id, title, status, spec, updated_at from persona_responsibilities
                         where persona_id = ? order by case status when 'active' then 0 else 1 end, updated_at desc`, [m.id]) : [];
  const bySlug = new Map();
  for (const r of rows) {
    const spec = parseSpec(r.spec);
    const slug = spec.recipeRef?.slug;
    if (slug && !bySlug.has(slug)) bySlug.set(slug, { ...r, spec });
  }
  return briefCharters(brief).map(({ slug, priority }) => {
    const row = bySlug.get(slug);
    if (row) {
      const p = row.spec.pacing ?? {};
      return {
        slug, title: row.title, priority: priority ?? row.spec.priority ?? null,
        need: row.spec.description?.need ?? null, coreAction: row.spec.description?.coreAction ?? null,
        pacingNote: p.coverageNote ?? null, lastDecidedAt: p.lastDecidedAt ?? null, lastDispatchedAt: p.lastDispatchedAt ?? null,
        dbStatus: row.status, source: 'db',
      };
    }
    const t = readTemplate(slug);
    if (t) {
      return { slug, title: t.title ?? slug, priority, need: t.description?.need ?? null, coreAction: t.description?.coreAction ?? null,
        pacingNote: null, lastDecidedAt: null, lastDispatchedAt: null, dbStatus: null, source: 'template' };
    }
    return { slug, title: slug, priority, need: null, coreAction: null, pacingNote: null,
      lastDecidedAt: null, lastDispatchedAt: null, dbStatus: null, source: 'slug-only' };
  });
}

/** Pending reviews the in-app master raised (persona_manual_reviews). */
export function pendingReviews(d, personaId) {
  if (!personaId) return [];
  return q(d, `select id, title, severity, created_at from persona_manual_reviews
               where persona_id = ? and status = 'pending' order by created_at`, [personaId]);
}

/** Operator lines in the master's in-app channel since an ISO instant. */
export function operatorChannelSince(d, personaId, since, limit = 5) {
  if (!personaId) return [];
  return q(d, `select id, substr(body, 1, 600) body, created_at from team_channel_messages
               where persona_id = ? and author_kind = 'user'
                 and datetime(substr(created_at, 1, 19)) > datetime(substr(?, 1, 19))
               order by created_at desc limit ?`, [personaId, since || '1970-01-01T00:00:00Z', limit]);
}

// ---------------------------------------------------------------- the project

function goals(d, projectId) {
  const rows = q(d, `select g.id, g.title, g.status, g.progress, g.order_index, g.created_at,
                            (select count(*) from dev_ideas i where i.goal_id = g.id) ideas,
                            (select count(*) from dev_tasks t where t.goal_id = g.id) tasks,
                            (select count(*) from dev_tasks t where t.goal_id = g.id and t.status = 'completed') completed_tasks
                     from dev_goals g where g.project_id = ? and g.parent_goal_id is null
                     order by g.order_index, g.created_at`, [projectId]);
  // Open work first (attention.rs order_goals_for_prompt): a cap must not bite the done ones first.
  return [...rows.filter((g) => g.status !== 'done'), ...rows.filter((g) => g.status === 'done')];
}

function acceptedNoTask(d, projectId) {
  return q(d, `select i.id, i.title, coalesce(i.updated_at, i.created_at) accepted_at
               from dev_ideas i
               where i.status = 'accepted' and i.project_id = ?
                 and coalesce(i.scan_type, '') <> '${PLATFORM_SCAN_TYPE}'
                 and not exists (select 1 from dev_tasks t where t.source_idea_id = i.id
                                 and not (t.status = 'failed' and coalesce(t.error, '') like '${ABANDONED_PREFIX}%'))
               order by accepted_at asc, i.id asc`, [projectId]);
}

/** Unmerged autopilot/* branches of a checkout, with ahead/behind against the base. */
export function unmergedBranches(root, base, cap = SNAPSHOT_CAPS.branches) {
  if (!root || !fs.existsSync(root)) return { total: 0, branches: [], error: `checkout ${root} not found` };
  let names;
  try {
    names = git(root, ['for-each-ref', '--sort=-committerdate', `--no-merged=refs/heads/${base}`,
      '--format=%(refname:short)|%(committerdate:iso8601)', 'refs/heads/autopilot/'])
      .trim().split('\n').filter(Boolean).map((l) => { const [branch, at] = l.split('|'); return { branch, at }; });
  } catch (e) { return { total: 0, branches: [], error: String(e.message || e).split('\n')[0] }; }
  const branches = names.slice(0, cap).map((b) => {
    try {
      const [behind, ahead] = git(root, ['rev-list', '--left-right', '--count', `refs/heads/${base}...refs/heads/${b.branch}`]).trim().split(/\s+/).map(Number);
      return { ...b, ahead, behind };
    } catch { return { ...b, ahead: null, behind: null }; }
  });
  return { total: names.length, branches };
}

/** Uncommitted paths in the project checkout (null when git cannot say). */
export function dirtyCount(root) {
  if (!root || !fs.existsSync(root)) return null;
  try { return git(root, ['status', '--porcelain', '--no-renames']).split('\n').filter(Boolean).length; } catch { return null; }
}
export function currentBranch(root) {
  try { return git(root, ['branch', '--show-current']).trim() || null; } catch { return null; }
}

/** (db, project: ProjectCtx) => {goals,acceptedNoTask,pendingCount,unratedCount,kpis,gitBranches} */
export function projectSnapshot(d, project) {
  const pid = project.id;
  const ideas = acceptedNoTask(d, pid);
  const pending = one(d, `select count(*) n, sum(risk is null) unrated from dev_ideas where project_id = ? and status = 'pending'`, [pid]);
  const kpi = one(d, `select count(*) active, sum(last_measured_at is null) unmeasured from dev_kpis where project_id = ? and status = 'active'`, [pid]);
  const unmeasured = q(d, `select name from dev_kpis where project_id = ? and status = 'active' and last_measured_at is null
                           order by created_at limit ?`, [pid, SNAPSHOT_CAPS.kpis]).map((r) => r.name);
  const inFlight = q(d, `select title, source_idea_id, status, started_at from dev_tasks
                         where project_id = ? and status in ('running', 'queued')
                         order by case status when 'running' then 0 else 1 end, coalesce(started_at, created_at) asc, id asc
                         limit ?`, [pid, SNAPSHOT_CAPS.inFlight]);
  // The pending ideas a verdict could name, highest impact for the least effort first.
  const pendingSample = q(d, `select id, title, effort, impact, risk from dev_ideas where project_id = ? and status = 'pending'
                              order by coalesce(impact, 0) desc, coalesce(effort, 9) asc, created_at asc limit ?`, [pid, SNAPSHOT_CAPS.ideas]);
  const g = goals(d, pid);
  return {
    goals: g,
    acceptedNoTask: { count: ideas.length, oldest: ideas.slice(0, SNAPSHOT_CAPS.ideas).map((i) => ({ id: i.id, title: i.title })) },
    pendingCount: pending?.n ?? 0,
    unratedCount: pending?.unrated ?? 0,
    pendingSample,
    kpis: { active: kpi?.active ?? 0, unmeasured: kpi?.unmeasured ?? 0, unmeasuredNames: unmeasured },
    inFlightTasks: inFlight,
    gitBranches: unmergedBranches(project.root, project.baseBranch),
    checkout: { branch: currentBranch(project.root), dirty: dirtyCount(project.root) },
    readErrors: dbErrors(d),
  };
}

/**
 * (db, projectId) => {rows:[{id,name,status,target_date}], error:string|null}   The project's milestones.
 * A failed read (an older DB without the table, a locked file) is an `error`, never an empty list:
 * "no milestones" is what triggers a PLAN WAKE, and an unreadable table must not.
 */
export function milestonesOf(d, projectId) {
  try {
    const rows = d.prepare(`select id, name, status, target_date from dev_milestones where project_id = ? order by order_index, created_at`)
      .all(projectId).map((r) => ({ ...r }));
    return { rows, error: null };
  } catch (e) { return { rows: [], error: String(e.message || e).split('\n')[0] }; }
}

/** (db, created:{milestones:{i:id}, goals:{"i.j":id}}) => {milestones:{id:{status}}, goals:{id:{status,progress}}} */
export function planProgress(d, created) {
  const mIds = Object.values(created?.milestones ?? {}).filter(Boolean);
  const gIds = Object.values(created?.goals ?? {}).filter(Boolean);
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  const marks = (n) => Array(n).fill('?').join(', ');
  return {
    milestones: mIds.length ? byId(q(d, `select id, status from dev_milestones where id in (${marks(mIds.length)})`, mIds)) : {},
    goals: gIds.length ? byId(q(d, `select id, status, progress from dev_goals where id in (${marks(gIds.length)})`, gIds)) : {},
  };
}

/** Rows of a read that may hit a table an older DB lacks: {rows, error} instead of a silent []. */
function tryRows(d, sql, params) {
  try { return { rows: d.prepare(sql).all(...params).map((r) => ({ ...r })), error: null }; } catch (e) { return { rows: [], error: String(e.message || e).split('\n')[0] }; }
}

/** (db, projectId) => {rows:[{id,name,slug,status,tier}], error}   The project's features (not archived). */
export function useCasesOf(d, projectId) {
  const r = tryRows(d, `select id, name, slug, status, tier from dev_use_cases where project_id = ? and status <> 'archived' order by name`, [projectId]);
  if (!r.error || !/no such column: tier/.test(r.error)) return r;
  return tryRows(d, `select id, name, slug, status, null tier from dev_use_cases where project_id = ? and status <> 'archived' order by name`, [projectId]);
}

/** (db, projectId) => {rows:[{slug, round_no, outcome, overall, coverage, must_address_json, run_dir, at}], error}   council runs the app holds */
export function councilRunsOf(d, projectId) {
  return tryRows(d, `select s.slug, r.round_no, r.outcome, r.overall, r.coverage, r.must_address_json, r.run_dir, coalesce(r.finished_at, r.ingested_at) at
                     from dev_council_runs r join dev_council_subjects s on s.id = r.subject_id
                     where s.project_id = ? and s.kind = 'use_case' order by at`, [projectId]);
}

/** (db, projectId) => {rows:[{slug, decision, reason, decided_at}], error}   a person's decisions at the council's gate */
export function councilDecisionsOf(d, projectId) {
  return tryRows(d, `select s.slug, x.decision, x.reason, x.decided_at
                     from dev_council_decisions x join dev_council_subjects s on s.id = x.subject_id
                     where s.project_id = ? and s.kind = 'use_case' order by x.decided_at`, [projectId]);
}

/** Repo docs the master and builders should read, by path (never inlined: kp's CLAUDE.md is 23KB). */
export function repoDocs(root) {
  return ['CLAUDE.md', 'AGENTS.md', path.join('.claude', 'CLAUDE.md')]
    .map((p) => path.join(root || '', p)).filter((p) => root && fs.existsSync(p));
}

