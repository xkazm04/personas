// WP1 test fixture (not a test file): a temp state root, a temp git checkout and a FIXTURE sqlite
// database shaped like the app's tables (only the columns WP1 reads). Call setupEnv() BEFORE
// importing contract.mjs: it points APPMASTER_STATE_ROOT / PERSONAS_DB / APPMASTER_HANDSHAKE at temp
// paths so no test can reach the real journal, the real app DB or a running app.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

export const IDS = {
  project: 'p-demo-0001', bare: 'p-bare-0002', master: 'm-master-01',
  ideaAccepted: 'i-accepted-no-task-1', ideaWithTask: 'i-accepted-with-task', ideaUnrated: 'i-pending-unrated-01',
  ideaPending: 'i-pending-rated-0001', ideaVerdict: 'i-pending-verdict-01', review: 'r-review-pending-1',
};

/** Temp dirs + env. Returns {tmp, stateRoot, dbPath, demoRoot, bareRoot}. */
export function setupEnv(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `appmaster-${tag}-`));
  const stateRoot = path.join(tmp, 'state');
  fs.mkdirSync(stateRoot, { recursive: true });
  process.env.APPMASTER_STATE_ROOT = stateRoot;
  process.env.PERSONAS_DB = path.join(tmp, 'personas.db');
  process.env.APPMASTER_HANDSHAKE = path.join(tmp, 'no-such-handshake.json');
  return { tmp, stateRoot, dbPath: process.env.PERSONAS_DB, demoRoot: path.join(tmp, 'demo'), bareRoot: path.join(tmp, 'bare') };
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** A checkout on `branch` with one commit; `autopilot` names an unmerged branch to cut. */
export function makeRepo(root, branch, { autopilot = null, dirty = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', branch);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# demo\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'init');
  if (autopilot) {
    git(root, 'checkout', '-q', '-b', autopilot);
    fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'work');
    git(root, 'checkout', '-q', branch);
  }
  if (dirty) fs.writeFileSync(path.join(root, 'a.txt'), 'changed\n');
}

const SCHEMA = `
create table dev_projects (id text primary key, name text, root_path text, description text, status text, main_branch text, workspace_id text);
create table personas (id text primary key, project_id text, name text, enabled integer, created_at text);
create table persona_responsibilities (id text primary key, persona_id text, project_id text, title text, status text, spec text, updated_at text);
create table persona_manual_reviews (id text primary key, execution_id text, persona_id text, title text, severity text, status text, reviewer_notes text, created_at text);
create table team_channel_messages (id text primary key, team_id text, persona_id text, author_kind text, body text, created_at text);
create table dev_goals (id text primary key, project_id text, parent_goal_id text, title text, status text, progress integer, order_index integer, created_at text);
create table dev_ideas (id text primary key, project_id text, title text, status text, scan_type text, effort integer, impact integer, risk integer, goal_id text, created_at text, updated_at text);
create table dev_tasks (id text primary key, project_id text, title text, description text, source_idea_id text, goal_id text, status text, error text, started_at text, created_at text);
create table dev_kpis (id text primary key, project_id text, name text, status text, last_measured_at text, created_at text);
create table dev_milestones (id text primary key, project_id text, name text, goal text, status text default 'planned', order_index integer default 0, target_date text, cut_at text, shipped_at text, created_at text, updated_at text, description text);
create table dev_milestone_items (milestone_id text, item_kind text, item_id text, bucket text default 'core');
create table dev_use_cases (id text primary key, project_id text, name text, slug text, status text default 'active', tier text default 'standard', created_at text);
create table dev_council_subjects (id text primary key, project_id text, kind text, use_case_id text, slug text, title text);
create table dev_council_runs (id text primary key, subject_id text, round_no integer, outcome text, overall real, coverage real, must_address_json text, run_dir text, finished_at text, ingested_at text);
create table dev_council_decisions (id text primary key, subject_id text, run_id text, decision text, reason text, decided_at text);
create table persona_reports (id text primary key, persona_id text, title text, content text, created_at text);
create table recipe_definitions (id text primary key, project_id text default 'default', name text, description text, prompt_template text, is_builtin integer default 0, created_at text, updated_at text);
`;

const sqlNow = (minAgo = 0) => new Date(Date.now() - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);

/** The fixture DB (WRITABLE handle, test-only). Returns the open handle; close it when done. */
export function makeDb(env) {
  const d = new DatabaseSync(env.dbPath);
  d.exec(SCHEMA);
  const run = (sql, ...p) => d.prepare(sql).run(...p);
  run('insert into dev_projects values (?,?,?,?,?,?,?)', IDS.project, 'Demo', env.demoRoot, 'demo', 'active', 'main', null);
  run('insert into dev_projects values (?,?,?,?,?,?,?)', IDS.bare, 'Bare', env.bareRoot, 'bare', 'active', 'main', null);
  run('insert into personas values (?,?,?,?,?)', IDS.master, IDS.project, 'App Master Demo', 1, '2026-09-01T00:00:00Z');
  const spec = {
    recipeRef: { slug: 'project-kpi-stewardship' }, priority: 1,
    description: { need: 'NEED-FROM-DB', coreAction: 'CORE-FROM-DB' },
    pacing: { coverageNote: 'NOTE-FROM-DB', lastDecidedAt: '2026-09-25T07:54:33.126043600+00:00', lastDispatchedAt: '2026-09-16T07:33:22+00:00' },
  };
  run('insert into persona_responsibilities values (?,?,?,?,?,?,?)', 'r1', IDS.master, IDS.project, 'Project KPI stewardship', 'active', JSON.stringify(spec), '2026-09-25T00:00:00Z');
  run('insert into persona_manual_reviews values (?,?,?,?,?,?,?,?)', IDS.review, 'e1', IDS.master, 'Pending in the app', 'info', 'pending', null, sqlNow(120));
  run('insert into team_channel_messages values (?,?,?,?,?,?)', 'c1', 't', IDS.master, 'user', 'Please focus on goal one', sqlNow(30));
  run('insert into dev_goals values (?,?,?,?,?,?,?,?)', 'g-open-0001', IDS.project, null, 'Open goal one', 'in-progress', 40, 0, '2026-09-01');
  run('insert into dev_goals values (?,?,?,?,?,?,?,?)', 'g-done-0002', IDS.project, null, 'Done goal two', 'done', 100, 1, '2026-09-01');
  const idea = (id, status, risk, title) => run('insert into dev_ideas values (?,?,?,?,?,?,?,?,?,?,?)', id, IDS.project, title, status, 'scan', 2, 3, risk, null, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z');
  idea(IDS.ideaAccepted, 'accepted', 2, 'Accepted with no task');
  idea(IDS.ideaWithTask, 'accepted', 2, 'Accepted with a task');
  idea(IDS.ideaUnrated, 'pending', null, 'Pending unrated');
  idea(IDS.ideaPending, 'pending', 1, 'Pending rated');
  idea(IDS.ideaVerdict, 'pending', 1, 'Pending for a verdict');
  run('insert into dev_tasks values (?,?,?,?,?,?,?,?,?,?)', 't1', IDS.project, 'Task in flight', 'x', IDS.ideaWithTask, null, 'running', null, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
  run('insert into dev_kpis values (?,?,?,?,?,?)', 'k1', IDS.project, 'Unmeasured KPI', 'active', null, '2026-09-01');
  run('insert into dev_kpis values (?,?,?,?,?,?)', 'k2', IDS.project, 'Measured KPI', 'active', '2026-09-05', '2026-09-01');
  // features (dev_use_cases) and the council history the app holds: an interactive full council that
  // failed one feature, and an operator's approval of another
  const uc = (id, slug, name) => run('insert into dev_use_cases (id, project_id, name, slug, status, tier, created_at) values (?,?,?,?,?,?,?)', id, IDS.project, name, slug, 'active', 'standard', '2026-09-01');
  uc('uc-org', 'org-journey', 'Org journey');
  uc('uc-bill', 'billing-flow', 'Billing flow');
  uc('uc-kpi', 'kpi-board', 'KPI board');
  run("insert into dev_council_subjects values ('s-bill', ?, 'use_case', 'uc-bill', 'billing-flow', 'Billing flow')", IDS.project);
  run("insert into dev_council_subjects values ('s-kpi', ?, 'use_case', 'uc-kpi', 'kpi-board', 'KPI board')", IDS.project);
  run("insert into dev_council_runs values ('cr-bill-1', 's-bill', 1, 'fail', 0.41, 0.8, ?, ?, '2026-09-20 10:00:00', '2026-09-20 10:05:00')",
    JSON.stringify(['Fix the refund path: a partial refund double-counts tax']), path.join(env.demoRoot, '.personas', 'council', 'runs', '2026-09-20-billing-flow-r1'));
  run("insert into dev_council_runs values ('cr-kpi-1', 's-kpi', 1, 'ready', 0.82, 0.9, '[]', ?, '2026-09-21 10:00:00', '2026-09-21 10:05:00')",
    path.join(env.demoRoot, '.personas', 'council', 'runs', '2026-09-21-kpi-board-r1'));
  run("insert into dev_council_decisions values ('cd-kpi', 's-kpi', 'cr-kpi-1', 'approved', 'looks right', '2026-09-22 09:00:00')");
  // v3 recipes (recipe_definitions): the slug and the description live inside prompt_template's JSON;
  // an older row of the same slug loses to the newest; a plain-text template is not a v3 recipe
  const recipe = (id, slug, name, need, coreAction, updated) => run('insert into recipe_definitions (id, name, description, prompt_template, created_at, updated_at) values (?,?,?,?,?,?)',
    id, name, 'flat description', JSON.stringify({ id, slug, title: name, description: { need, coreAction } }), updated, updated);
  recipe('rec-kpi-old', 'project-kpi-stewardship', 'Old KPI recipe', 'OLD-NEED', 'OLD-CORE', '2026-01-01T00:00:00Z');
  recipe('rec-kpi', 'project-kpi-stewardship', 'Project KPI and coverage stewardship', 'RECIPE-NEED-KPI', 'RECIPE-CORE-KPI', '2026-09-30T00:00:00Z');
  recipe('rec-del', 'accepted-idea-delivery', 'Accepted idea delivery to the main branch', 'RECIPE-NEED-DELIVERY', 'RECIPE-CORE-DELIVERY', '2026-09-30T00:00:00Z');
  run("insert into recipe_definitions (id, name, prompt_template, created_at, updated_at) values ('rec-plain', 'Plain', 'not json at all', '2026-09-30', '2026-09-30')");
  return d;
}

export const demoBrief = (charters) => ({
  project: 'demo', product: 'A demo product', stage: 'prototype', operatorRole: 'CEO-level counsel',
  goals: [{ title: 'Key goal one', measure: 'a measured thing' }],
  charters, model: 'claude-opus-5', maxParallel: 1, boundaries: ['never touch secrets/'], askFor: ['scope change'],
  pacing: 'self-paced', reportStyle: 'plain', digestCadence: 'each wake',
  headless: true,   // outside DEFAULT_MANAGED, so the fixture project opts in
});
