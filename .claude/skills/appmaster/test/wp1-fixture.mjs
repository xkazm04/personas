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
  return d;
}

export const demoBrief = (charters) => ({
  project: 'demo', product: 'A demo product', stage: 'prototype', operatorRole: 'CEO-level counsel',
  goals: [{ title: 'Key goal one', measure: 'a measured thing' }],
  charters, model: 'claude-opus-5', maxParallel: 1, boundaries: ['never touch secrets/'], askFor: ['scope change'],
  pacing: 'self-paced', reportStyle: 'plain', digestCadence: 'each wake',
  headless: true,   // outside DEFAULT_MANAGED, so the fixture project opts in
});
