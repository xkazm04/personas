// WP1: decision validation + decide, asks (say/asks/answer), onboard. Temp state root only; the app
// DB path points at a file that does not exist, proving decide/answer/onboard never need it.
// Run: node --test .claude/skills/appmaster/test/decision.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupEnv, demoBrief } from './wp1-fixture.mjs';

const env = setupEnv('decide');   // PERSONAS_DB points at a missing file: nothing here may read the app DB
const C = await import('../lib/contract.mjs');
const S = await import('../lib/store.mjs');
const V = await import('../lib/decision.mjs');
const A = await import('../lib/asks.mjs');
const O = await import('../lib/onboard.mjs');

const project = { slug: 'demo', id: 'p-demo', name: 'Demo', root: 'C:/x/demo', baseBranch: 'main' };
const CHARTERS = [
  { slug: 'project-kpi-stewardship', priority: 1 },
  { slug: 'codebase-architecture-review', priority: 4 },
  { slug: 'technical-decision-capture', priority: null },
];
const brief = demoBrief(CHARTERS);
S.saveBrief('demo', brief);

const opts = [{ label: 'Yes', action: 'do it' }, { label: 'No', action: 'drop it' }];
const valid = (wakeId, over = {}) => ({
  wakeId,
  dispatch: [{ charterSlug: 'codebase-architecture-review', reason: 'starved 28d', brief: 'review the module seams', ideaIds: [] }],
  defer: [{ charterSlug: 'project-kpi-stewardship', reason: 'ran yesterday' }, { charterSlug: 'technical-decision-capture', reason: 'nothing new' }],
  asks: [{ kind: 'scope', question: 'Drop goal two?', context: 'it conflicts with goal one', options: opts }],
  ideaVerdicts: [{ ideaId: 'idea-1', status: 'accepted', reason: 'cheap and clear' }],
  say: 'Reviewing architecture this wake.',
  note: 'architecture dispatched; kpi next',
  nextWakeMinutes: 30,
  ...over,
});
let n = 0;
function newWake() {
  const wakeId = `w-${++n}`;
  S.saveWake('demo', { wakeId, slug: 'demo', at: C.nowIso(), contextPath: 'x.md', status: 'context', project });
  return wakeId;
}
function writeFile(name, content) {
  const p = path.join(env.tmp, name);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return p;
}
const ctx = (wakeId) => ({ slug: 'demo', wakeId, brief });

test('validateDecision accepts a well-formed decision', () => {
  assert.deepEqual(V.validateDecision(valid('w'), ctx('w')), { ok: true, errors: [] });
});

test('validateDecision rejects each rule the schema and the cross-field contract state', () => {
  const cases = {
    'skipped charter': [valid('w', { defer: [{ charterSlug: 'project-kpi-stewardship', reason: 'r' }] }), /"technical-decision-capture" is missing/],
    'duplicated charter': [valid('w', { defer: [...valid('w').defer, { charterSlug: 'codebase-architecture-review', reason: 'r' }] }), /appears 2 times/],
    'two dispatches': [valid('w', { dispatch: [valid('w').dispatch[0], { charterSlug: 'project-kpi-stewardship', reason: 'r', brief: 'b', ideaIds: [] }], defer: [{ charterSlug: 'technical-decision-capture', reason: 'r' }] }), /at most 1 per wake/],
    'four asks': [valid('w', { asks: [1, 2, 3, 4].map((i) => ({ kind: 'scope', question: `q${i}`, context: '', options: opts })) }), /asks has 4 entries; at most 3/],
    'nextWakeMinutes 9': [valid('w', { nextWakeMinutes: 9 }), /nextWakeMinutes must be an integer 10\.\.240, got 9/],
    'nextWakeMinutes 241': [valid('w', { nextWakeMinutes: 241 }), /got 241/],
    'nextWakeMinutes 30.5': [valid('w', { nextWakeMinutes: 30.5 }), /got 30\.5/],
    'unknown charter slug': [valid('w', { defer: [...valid('w').defer, { charterSlug: 'invented-charter', reason: 'r' }] }), /unknown charter slug "invented-charter"/],
    'wakeId mismatch': [valid('other-wake'), /wakeId "other-wake" does not match the wake "w"/],
    'ask with one option': [valid('w', { asks: [{ kind: 'scope', question: 'q', context: '', options: [opts[0]] }] }), /options has 1; 2-4 required/],
    'ask kind': [valid('w', { asks: [{ kind: 'accept_ideas', question: 'q', context: '', options: opts }] }), /kind "accept_ideas" is not one of/],
    'missing say': [(() => { const d = valid('w'); delete d.say; return d; })(), /missing required key "say"/],
    'say not a string': [valid('w', { say: 5 }), /say must be a string or null/],
    'empty ideaId': [valid('w', { ideaVerdicts: [{ ideaId: '', status: 'accepted', reason: 'r' }] }), /ideaId must be a non-empty string/],
    'empty dispatch ideaId': [valid('w', { dispatch: [{ ...valid('w').dispatch[0], ideaIds: [''] }] }), /ideaIds\[0\] must be a non-empty string/],
    'extra key': [valid('w', { hires: [] }), /unknown key "hires"/],
    'arrays absent': [valid('w', { asks: undefined }), /asks must be an array/],
  };
  for (const [name, [decision, re]] of Object.entries(cases)) {
    const r = V.validateDecision(JSON.parse(JSON.stringify(decision)), ctx('w'));
    assert.equal(r.ok, false, `${name} was accepted`);
    assert.ok(r.errors.some((e) => re.test(e)), `${name}: ${JSON.stringify(r.errors)} lacks ${re}`);
  }
});

test('extractDecision: bare, fenced, inside prose; refuses none and two', () => {
  const d = valid('w');
  assert.deepEqual(V.extractDecision(JSON.stringify(d)), d);
  assert.deepEqual(V.extractDecision(`Here it is:\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\nDone.`), d);
  assert.deepEqual(V.extractDecision(`My decision {as asked}: ${JSON.stringify(d)} -- end`), d);
  assert.throws(() => V.extractDecision('no json here'), /no JSON object/);
  assert.throws(() => V.extractDecision(`${JSON.stringify(d)}\n${JSON.stringify(d)}`), /2 top-level JSON objects/);
});

test('builderModel: brief byCharter, then the contract default by charter, then the brief builder, then Sonnet', () => {
  assert.equal(V.builderModel({}, 'codebase-architecture-review'), C.MODELS.builderByCharter['codebase-architecture-review']);
  assert.equal(V.builderModel({}, 'project-kpi-stewardship'), C.MODELS.builder);
  assert.equal(V.builderModel({ models: { builder: 'b-x' } }, 'project-kpi-stewardship'), 'b-x');
  assert.equal(V.builderModel({ models: { byCharter: { 'codebase-architecture-review': 'm-y' } } }, 'codebase-architecture-review'), 'm-y');
});

test('decide: mints the run, queues the outbox, raises the ask, decides the wake', async () => {
  const w = newWake();
  const file = writeFile('d1.json', `\`\`\`json\n${JSON.stringify(valid(w))}\n\`\`\``);
  const before = Date.now();
  const r = await V.cmdDecide({ flags: { project: 'demo', wake: w, file } });
  assert.equal(r.wakeId, w);
  assert.equal(r.runIds.length, 1);
  const run = S.loadRun('demo', r.runIds[0]);
  assert.equal(run.state, 'planned'); assert.equal(run.charterSlug, 'codebase-architecture-review');
  assert.equal(run.model, C.MODELS.builderByCharter['codebase-architecture-review']);
  assert.equal(run.brief, 'review the module seams'); assert.deepEqual(run.project, project);
  const ob = S.loadOutbox('demo');
  assert.deepEqual(ob.map((e) => e.kind).sort(), ['ask', 'idea-verdict', 'say']);
  assert.deepEqual(r.outbox.sort(), ob.map((e) => e.id).sort());
  assert.equal(ob.find((e) => e.kind === 'ask').payload.op, 'raise');
  assert.equal(ob.find((e) => e.kind === 'say').payload.from, 'master');
  assert.ok(ob.every((e) => e.projectId === 'p-demo' && e.source.wakeId === w));
  const ask = S.openAsks('demo').find((a) => a.askId === r.asks[0]);
  assert.equal(ask.question, 'Drop goal two?'); assert.equal(ask.source, 'master'); assert.equal(ask.wakeId, w);
  const wake = S.loadWake('demo', w);
  assert.equal(wake.status, 'decided'); assert.deepEqual(wake.runIds, r.runIds); assert.equal(wake.note, 'architecture dispatched; kpi next');
  const due = Date.parse(r.nextWakeAt) - before;
  assert.ok(due >= 30 * 60000 - 5000 && due <= 30 * 60000 + 60000, `nextWakeAt is ${due} ms out`);
});

test('decide is idempotent: the same decision again returns the earlier result and queues nothing new', async () => {
  const w = S.loadWakes('demo').find((x) => x.status === 'decided').wakeId;
  const file = writeFile('d1b.json', valid(w));
  const counts = () => [S.loadOutbox('demo').length, S.loadAsks('demo').length, S.listRuns('demo').length];
  const before = counts();
  const first = S.loadWake('demo', w).result;
  const again = await V.cmdDecide({ flags: { project: 'demo', wake: w, file } });
  assert.equal(again.repeated, true);
  assert.deepEqual(again.runIds, first.runIds);
  assert.deepEqual(counts(), before);
  const changed = writeFile('d1c.json', valid(w, { nextWakeMinutes: 45 }));
  await assert.rejects(V.cmdDecide({ flags: { project: 'demo', wake: w, file: changed } }), (e) => e instanceof C.Refusal && e.reason === 'wake already decided');
});

test('decide refuses an invalid decision and writes nothing', async () => {
  const w = newWake();
  const counts = () => [S.loadOutbox('demo').length, S.loadAsks('demo').length, S.listRuns('demo').length];
  const before = counts();
  const file = writeFile('bad.json', valid(w, { nextWakeMinutes: 9, defer: [] }));
  await assert.rejects(V.cmdDecide({ flags: { project: 'demo', wake: w, file } }), (e) => {
    assert.ok(e instanceof C.Refusal); assert.equal(e.reason, 'invalid decision');
    assert.ok(e.extra.errors.length >= 3, JSON.stringify(e.extra.errors));
    return true;
  });
  assert.deepEqual(counts(), before);
  assert.equal(S.loadWake('demo', w).status, 'context');
  await assert.rejects(V.cmdDecide({ flags: { project: 'demo', wake: 'no-such-wake', file } }), (e) => e.reason === 'unknown wake');
});

test('decide mints runs BEFORE the outbox: a failing outbox write leaves the planned run and an undecided wake', async () => {
  const w = newWake();
  const file = writeFile('d2.json', valid(w, { ideaVerdicts: [{ ideaId: 'idea-2', status: 'rejected', reason: 'duplicate' }] }));
  const outbox = C.outboxPath('demo');
  const saved = fs.readFileSync(outbox);
  fs.rmSync(outbox); fs.mkdirSync(outbox);   // appendFileSync on a directory throws: the outbox write fails
  try {
    await assert.rejects(V.cmdDecide({ flags: { project: 'demo', wake: w, file } }), /EISDIR|EPERM|illegal operation/i);
  } finally { fs.rmSync(outbox, { recursive: true }); fs.writeFileSync(outbox, saved); }
  const planned = S.listRuns('demo').filter((r) => r.wakeId === w);
  assert.equal(planned.length, 1); assert.equal(planned[0].state, 'planned');
  assert.equal(S.loadWake('demo', w).status, 'context');
  // The repaired re-submission reuses the run this wake already minted.
  const r = await V.cmdDecide({ flags: { project: 'demo', wake: w, file } });
  assert.deepEqual(r.runIds, [planned[0].runId]);
  assert.equal(S.listRuns('demo').filter((x) => x.wakeId === w).length, 1);
  assert.equal(S.loadWake('demo', w).status, 'decided');
});

test('say: appends the channel and queues an operator say for replay', async () => {
  const file = writeFile('msg.md', 'Focus on goal one this week.');
  const r = await A.cmdSay({ flags: { project: 'demo', file } });
  assert.equal(S.loadChannel('demo').at(-1).message, 'Focus on goal one this week.');
  const e = S.loadOutbox('demo').find((x) => x.id === r.outbox);
  assert.deepEqual([e.kind, e.payload.from, e.payload.channelId], ['say', 'operator', r.id]);
  const t = await A.cmdSay({ flags: { project: 'demo', text: 'inline too' } });
  assert.equal(S.loadChannel('demo').find((c) => c.id === t.id).message, 'inline too');
  await assert.rejects(A.cmdSay({ flags: { project: 'demo', text: '  ' } }), /non-empty message/);
});

test('asks and answer: options or Other with notes; the resolution is queued; a second answer is refused', async () => {
  const open = await A.cmdAsks({ flags: {} });
  assert.ok(open.length >= 1);
  const ask = open[0];
  assert.deepEqual((await A.cmdAsks({ flags: { project: 'demo' } })).map((a) => a.askId), open.map((a) => a.askId));
  await assert.rejects(A.cmdAnswer({ flags: { ask: ask.askId, choice: 'Maybe' } }), (e) => e.reason === 'choice is not an option');
  await assert.rejects(A.cmdAnswer({ flags: { ask: ask.askId, choice: 'Other' } }), (e) => e.reason === 'choice Other needs --notes');
  const r = await A.cmdAnswer({ flags: { ask: ask.askId.slice(0, 8), choice: 'yes', notes: 'go' } });
  assert.equal(r.state, 'answered'); assert.equal(r.answer.choice, 'Yes'); assert.equal(r.answer.notes, 'go');
  const e = S.loadOutbox('demo').find((x) => x.id === r.outbox);
  assert.deepEqual([e.kind, e.payload.op, e.payload.askId, e.payload.choice, e.payload.action], ['ask', 'resolve', ask.askId, 'Yes', 'do it']);
  await assert.rejects(A.cmdAnswer({ flags: { ask: ask.askId, choice: 'No' } }), (x) => x.reason === 'ask already answered');
  const other = open[1] ?? null;
  if (other) {
    const o = await A.cmdAnswer({ flags: { ask: other.askId, choice: 'Other', notes: 'something else' } });
    assert.equal(o.answer.choice, 'Other');
  }
});

test('onboard: validates, writes, refuses to overwrite, keeps a backup with --force', async () => {
  assert.deepEqual(O.validateBrief({ charters: [] }).ok, false);
  const bad = O.validateBrief({ charters: [{ slug: 'Not A Slug', priority: 9 }, 'dup', 'dup'], gates: { test: 3 }, extraThing: 1 });
  assert.equal(bad.ok, false);
  for (const re of [/not a kebab-case recipe slug/, /priority must be an integer 1..5/, /listed twice/, /gates must map/]) assert.ok(bad.errors.some((e) => re.test(e)), re.source);
  assert.ok(bad.warnings.some((w) => /unknown key "extraThing"/.test(w)));
  const kp = { product: 'p', charters: [{ slug: 'project-kpi-stewardship', priority: 1 }, { slug: 'technical-decision-capture' }], askFor: 'a sentence', tone: 't', extra: 'x', maxConcurrent: 2 };
  assert.equal(O.validateBrief(kp).ok, true, 'the kp brief shape (askFor string, tone, extra) is valid');

  const f = writeFile('brief-new.json', { ...kp, headless: true });
  const r = await O.cmdOnboard({ flags: { project: 'newproj', brief: f } });
  assert.equal(r.slug, 'newproj'); assert.equal(r.briefPath, C.briefPath('newproj'));
  assert.match(r.slugFrom, /app DB unreadable/);
  assert.deepEqual(S.loadBrief('newproj').charters, kp.charters);
  await assert.rejects(O.cmdOnboard({ flags: { project: 'newproj', brief: f } }), (e) => e.reason === 'brief exists');
  const f2 = writeFile('brief-new2.json', { ...kp, product: 'changed', headless: true });
  const forced = await O.cmdOnboard({ flags: { project: 'newproj', brief: f2, force: true } });
  assert.ok(forced.backup && fs.existsSync(forced.backup));
  assert.equal(JSON.parse(fs.readFileSync(forced.backup, 'utf8')).product, 'p');
  assert.equal(S.loadBrief('newproj').product, 'changed');
  await assert.rejects(O.cmdOnboard({ flags: { project: 'x', brief: writeFile('b.json', '{nope') } }), (e) => e.reason === 'invalid brief');
});

test('unknownIdeaIds: a retyped idea id is refused against dev_ideas; no DB means no check', async () => {
  const F = await import('./wp1-fixture.mjs');
  const named = (ids) => ({ dispatch: [{ charterSlug: 'x', reason: 'r', brief: 'b', ideaIds: ids }], ideaVerdicts: [] });
  assert.deepEqual(V.unknownIdeaIds(F.IDS.project, named(['whatever'])), [], 'database absent: degrade to no check');
  const db = F.makeDb(env); db.close();   // the fixture DB now exists at PERSONAS_DB
  try {
    assert.deepEqual(V.unknownIdeaIds(F.IDS.project, named([F.IDS.ideaAccepted])), []);
    const retyped = F.IDS.ideaAccepted.replace('accepted', 'acceptxd');
    assert.deepEqual(V.unknownIdeaIds(F.IDS.project, { ...named([]), ideaVerdicts: [{ ideaId: retyped, status: 'accepted', reason: 'r' }] }), [retyped]);
    assert.deepEqual(V.unknownIdeaIds(F.IDS.bare, named([F.IDS.ideaAccepted])), [F.IDS.ideaAccepted], 'an id of another project is unknown here');
  } finally { fs.rmSync(env.dbPath, { force: true }); }
});

test('cleanup', () => { fs.rmSync(env.tmp, { recursive: true, force: true }); });
