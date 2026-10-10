// A full-ready council report's Approval is the operator's verdict wherever it is decided: at the desk
// or on the phone (review_decide syncs it back into persona_manual_reviews). councilDecisionsOf counts
// it beside the Council page's own decisions, so the master sees `approved` / `rejected` either way.
// In-memory DB; never the live app.
// Run: node --test .claude/skills/appmaster/test/council-approvals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { councilDecisionsOf } from '../lib/dbread.mjs';
import { featureOfReportTitle, featureState, reportTitle } from '../lib/council.mjs';

const P = 'proj-1';
const MASTER = 'pers-master';
const OTHER = 'pers-other-project';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    create table persona_responsibilities (id text primary key, persona_id text, project_id text);
    create table dev_council_subjects (id text primary key, project_id text, kind text, slug text);
    create table dev_council_decisions (id text primary key, subject_id text, decision text, reason text, decided_at text);
    create table persona_reports (id text primary key, persona_id text, title text);
    create table persona_manual_reviews (id text primary key, persona_id text, title text, status text,
      context_data text, reviewer_notes text, resolved_at text, updated_at text);`);
  d.prepare('insert into persona_responsibilities values (?,?,?)').run('r1', MASTER, P);
  d.prepare('insert into persona_responsibilities values (?,?,?)').run('r2', OTHER, 'proj-2');
  return d;
}
const report = (d, id, persona, slug) => d.prepare('insert into persona_reports values (?,?,?)').run(id, persona, reportTitle(slug, 1));
const review = (d, id, persona, status, ctx, notes = null, at = '2026-10-08T12:00:00Z') =>
  d.prepare('insert into persona_manual_reviews values (?,?,?,?,?,?,?,?)').run(id, persona, 'Approve?', status, ctx, notes, status === 'pending' ? null : at, at);

test('the report title round-trips to its feature; any other title names none', () => {
  assert.equal(featureOfReportTitle(reportTitle('candidate-pipeline-board', 2)), 'candidate-pipeline-board');
  assert.equal(featureOfReportTitle('Weekly digest'), null);
  assert.equal(featureOfReportTitle(null), null);
});

test('a decided report Approval counts as a council decision; pending, resolved and foreign ones do not', () => {
  const d = db();
  report(d, 'rep-a', MASTER, 'fleet');
  report(d, 'rep-b', MASTER, 'needs-you');
  report(d, 'rep-c', MASTER, 'setup');
  report(d, 'rep-d', OTHER, 'elsewhere');
  review(d, 'm-a', MASTER, 'approved', JSON.stringify({ reportId: 'rep-a' }), 'ship it');
  review(d, 'm-b', MASTER, 'rejected', JSON.stringify({ reportId: 'rep-b' }), 'value line still open', '2026-10-08T13:00:00Z');
  review(d, 'm-c', MASTER, 'pending', JSON.stringify({ reportId: 'rep-c' }));
  review(d, 'm-r', MASTER, 'resolved', JSON.stringify({ reportId: 'rep-c' }));
  review(d, 'm-d', OTHER, 'approved', JSON.stringify({ reportId: 'rep-d' }));
  review(d, 'm-bad', MASTER, 'approved', '{not json');
  review(d, 'm-none', MASTER, 'approved', null);

  const out = councilDecisionsOf(d, P);
  assert.equal(out.error, null);
  assert.equal(out.approvalsError, null);
  assert.deepEqual(out.rows.map((r) => [r.slug, r.decision, r.via]), [['fleet', 'approved', 'approval'], ['needs-you', 'rejected', 'approval']]);
  assert.equal(out.rows[1].reason, 'value line still open');
});

test('Council page decisions and Approvals merge in time order, and featureState takes the newest', () => {
  const d = db();
  d.prepare('insert into dev_council_subjects values (?,?,?,?)').run('s1', P, 'use_case', 'fleet');
  d.prepare('insert into dev_council_decisions values (?,?,?,?,?)').run('x1', 's1', 'rejected', 'desk said no', '2026-10-08 09:00:00');
  report(d, 'rep-a', MASTER, 'fleet');
  review(d, 'm-a', MASTER, 'approved', JSON.stringify({ reportId: 'rep-a' }), null, '2026-10-08T15:00:00Z');

  const { rows } = councilDecisionsOf(d, P);
  assert.deepEqual(rows.map((r) => [r.decision, r.via]), [['rejected', 'council'], ['approved', 'approval']]);
  const ev = { mode: 'full', outcome: 'ready', at: '2026-10-08T08:00:00Z', mustAddress: [] };
  assert.equal(featureState('fleet', [ev], rows).state, 'approved');
});

test('an older DB without the review columns still returns the Council page decisions', () => {
  const d = new DatabaseSync(':memory:');
  d.exec(`create table dev_council_subjects (id text primary key, project_id text, kind text, slug text);
          create table dev_council_decisions (id text primary key, subject_id text, decision text, reason text, decided_at text);`);
  d.prepare('insert into dev_council_subjects values (?,?,?,?)').run('s1', P, 'use_case', 'fleet');
  d.prepare('insert into dev_council_decisions values (?,?,?,?,?)').run('x1', 's1', 'approved', null, '2026-10-08 09:00:00');
  const out = councilDecisionsOf(d, P);
  assert.equal(out.error, null);
  assert.match(out.approvalsError, /no such table/);
  assert.deepEqual(out.rows.map((r) => [r.slug, r.decision]), [['fleet', 'approved']]);
});
