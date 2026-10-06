// WP0 contract test: the journal CRUD is real, every subcommand maps to an exported function,
// and the decision schema is well-formed. Run: node --test .claude/skills/appmaster/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-test-'));
process.env.APPMASTER_STATE_ROOT = tmp;
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const { COMMANDS, parseArgs } = await import('../appmaster.mjs');

const project = { slug: 'demo', id: 'p1', name: 'Demo', root: 'C:/x/demo', baseBranch: 'main' };

test('slugOf uses the root basename (kp is CandiDate in dev_projects)', () => {
  assert.equal(C.slugOf('CandiDate', 'C:\\Users\\kazda\\kiro\\kp'), 'kp');
  assert.equal(C.slugOf('ascent', 'C:\\Users\\kazda\\kiro\\ascent\\'), 'ascent');
});

test('every subcommand binds to an exported function', async () => {
  for (const [name, [file, fn]] of Object.entries(COMMANDS)) {
    const mod = await import(new URL(file, new URL('../appmaster.mjs', import.meta.url)).href);
    assert.equal(typeof mod[fn], 'function', `${name} -> ${file}#${fn}`);
  }
});

test('parseArgs: positionals, valued flags, boolean flags', () => {
  const a = parseArgs(['replay', '--dry-run', '--project', 'kp']);
  assert.deepEqual(a._, ['replay']);
  assert.equal(a.flags['dry-run'], true);
  assert.equal(a.flags.project, 'kp');
});

test('runs: minted before effects, listed, found by short id', () => {
  const r = S.newRun(project, { wakeId: 'w1', charterSlug: 'accepted-idea-delivery', reason: 'r', brief: 'b', model: C.MODELS.builder });
  assert.equal(r.state, 'planned');
  assert.equal(S.loadRun('demo', r.runId).runId, r.runId);
  assert.equal(S.listRuns('demo', { states: ['planned'] }).length, 1);
  fs.mkdirSync(path.dirname(C.briefPath('demo')), { recursive: true });
  fs.writeFileSync(C.briefPath('demo'), '{"charters":[],"headless":true}');
  fs.mkdirSync(path.dirname(C.briefPath('firetv')), { recursive: true });
  fs.writeFileSync(C.briefPath('firetv'), '{"charters":[]}');
  assert.deepEqual(S.listSlugs(), ['demo']);
  assert.equal(S.findRun(C.shortId(r.runId)).runId, r.runId);
  assert.throws(() => S.saveRun({ ...r, state: 'nope' }), /bad run state/);
});

test('outbox is idempotent on kind+payload and latest line wins', () => {
  const a = S.queueOutbox('demo', 'p1', 'idea-verdict', { ideaId: 'i1', status: 'accepted', reason: 'x' }, { wakeId: 'w1' });
  const b = S.queueOutbox('demo', 'p1', 'idea-verdict', { reason: 'x', status: 'accepted', ideaId: 'i1' }, { wakeId: 'w2' });
  assert.equal(a.id, b.id);
  assert.equal(S.loadOutbox('demo').length, 1);
  S.updateOutbox('demo', a.id, { state: 'replayed', evidence: 'db: accepted' });
  assert.equal(S.loadOutbox('demo')[0].state, 'replayed');
  assert.equal(S.loadOutbox('demo')[0].payload.ideaId, 'i1');
});

test('asks: raise, answer, open filter', () => {
  const ask = S.raiseAsk('demo', { wakeId: 'w1', source: 'master', kind: 'scope', question: 'q', context: 'c', options: [{ label: 'a', action: 'x' }, { label: 'b', action: 'y' }] });
  assert.equal(S.openAsks('demo').length, 1);
  S.updateAsk('demo', ask.askId, { state: 'answered', answer: { choice: 'a', notes: 'n', at: C.nowIso() } });
  assert.equal(S.openAsks('demo').length, 0);
});

test('wakes: a later partial line merges over the earlier one', () => {
  S.saveWake('demo', { wakeId: 'w9', slug: 'demo', at: C.nowIso(), contextPath: 'p', status: 'context' });
  S.saveWake('demo', { wakeId: 'w9', status: 'decided', nextWakeAt: '2026-10-05T12:00:00Z' });
  const w = S.loadWake('demo', 'w9');
  assert.equal(w.status, 'decided');
  assert.equal(w.contextPath, 'p');
});

test('decision schema parses and names the contract fields', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../schema/decision.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.required.sort(), ['asks', 'dispatch', 'defer', 'ideaVerdicts', 'nextWakeMinutes', 'note', 'say', 'wakeId'].sort());
  assert.equal(schema.properties.nextWakeMinutes.minimum, C.WAKE_MIN);
  assert.equal(schema.properties.nextWakeMinutes.maximum, C.WAKE_MAX);
  assert.equal(schema.properties.asks.maxItems, C.MAX_ASKS);
  assert.equal(schema.properties.dispatch.maxItems, C.MAX_DISPATCH);
  const item = schema.properties.dispatch.items.properties;
  assert.deepEqual(item.model.enum.filter((m) => m !== null).sort(), [...C.BUILDER_MODEL_CHOICES].sort(), 'the schema names the models contract.mjs knows');
  assert.ok(item.model.enum.includes(null));
  assert.equal(item.paths.type, 'array');
  assert.ok(!schema.properties.dispatch.items.required.includes('paths'), 'paths is optional for one dispatch (required for two by validateDecision)');
});

test('caps: two builders per project, four in all, two dispatches per wake', () => {
  assert.equal(C.PER_PROJECT_CAP, 2);
  assert.equal(C.MAX_DISPATCH, C.PER_PROJECT_CAP);
  assert.equal(C.GLOBAL_CAP, 4);
  assert.ok(C.MEM.dispatchMinFreeGb > 0 && C.MEM.perBuilderReserveGb > 0, 'the free-memory brake is kept');
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
