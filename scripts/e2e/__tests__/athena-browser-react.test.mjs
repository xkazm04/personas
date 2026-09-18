// node --test scripts/e2e/__tests__/athena-browser-react.test.mjs
// Run with NODE_TEST_CONTEXT unset: an inherited value makes `node --test`
// exit 0 on failures (repo memory: NODE_TEST_CONTEXT false-green).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETUPS, aggregate, dedupeRows, parseScenarios, parseSetups, pctl, reduceTimeline, renderReport, rowKey, turnIdsInSession,
} from '../lib/athena-browser-react-lib.mjs';

test('parseSetups: the default spec yields two main-tier claude setups', () => {
  const s = parseSetups(DEFAULT_SETUPS);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { id: 'main:claude:claude-opus-5:low', tier: 'main', engine: 'claude', model: 'claude-opus-5', effort: 'low' });
  assert.equal(s[1].model, 'claude-sonnet-5');
});

test('parseSetups: a missing or empty effort means the calibrated default', () => {
  assert.equal(parseSetups('main:grok:grok-4.6')[0].effort, '');
  assert.equal(parseSetups('main:grok:grok-4.6:')[0].effort, '');
});

test('parseSetups: rejects a non-main tier, an unknown engine and a bad shape', () => {
  assert.throws(() => parseSetups('aside:claude:claude-sonnet-5:low'), /only the main tier/);
  assert.throws(() => parseSetups('main:gemini:x:low'), /engine must be/);
  assert.throws(() => parseSetups('main:claude'), /tier:engine:model/);
  assert.throws(() => parseSetups(''), /empty/);
});

test('parseScenarios: defaults to both, dedupes, rejects unknown', () => {
  assert.deepEqual(parseScenarios(undefined), ['A', 'B']);
  assert.deepEqual(parseScenarios('b,a,b'), ['B', 'A']);
  assert.throws(() => parseScenarios('C'), /unknown scenario/);
});

const ev = (over) => ({
  perfNow: 0, wallMs: 0, sessionId: 'conv1', turnId: 't1', kind: 'cli', cliType: null, deltaType: null, toolName: null,
  isTextDelta: false, isResult: false, resultSubtype: null, isError: false, ...over,
});

const FEED = [
  ev({ perfNow: 1005, wallMs: 100_005, kind: 'started', cliType: null }),
  ev({ perfNow: 1900, wallMs: 100_900, cliType: 'stream_event', deltaType: 'thinking_delta' }),
  ev({ perfNow: 2500, wallMs: 101_500, cliType: 'stream_event', toolName: 'WebSearch' }),
  ev({ perfNow: 3400, wallMs: 102_400, cliType: 'stream_event', deltaType: 'text_delta', isTextDelta: true }),
  ev({ perfNow: 3600, wallMs: 102_600, cliType: 'stream_event', deltaType: 'text_delta', isTextDelta: true }),
  ev({ perfNow: 4000, wallMs: 103_000, cliType: 'assistant', toolName: 'WebFetch' }),
  ev({ perfNow: 9000, wallMs: 108_000, cliType: 'result', isResult: true, resultSubtype: 'success' }),
  ev({ perfNow: 9010, wallMs: 108_010, kind: 'finished' }),
  // another turn in the same session, must not leak in
  ev({ perfNow: 9500, wallMs: 108_500, turnId: 't2', kind: 'started' }),
  ev({ perfNow: 9900, wallMs: 108_900, turnId: 't2', cliType: 'stream_event', deltaType: 'text_delta', isTextDelta: true }),
];

test('reduceTimeline: first text vs first chunk are separate series anchored at the send stamp', () => {
  const r = reduceTimeline(FEED, { turnId: 't1', sessionId: 'conv1', sendPerfNow: 1000 });
  assert.equal(r.uiStartedMs, 5);
  assert.equal(r.uiFirstChunkMs, 900);
  assert.equal(r.uiFirstChunkKind, 'thinking_delta');
  assert.equal(r.uiFirstTextMs, 2400);
  assert.equal(r.uiFinishedMs, 8010);
  assert.equal(r.firstTextWallMs, 102_400);
  assert.deepEqual(r.toolsUsed, ['WebSearch', 'WebFetch']);
  assert.equal(r.errored, false);
  assert.equal(r.unmeasured, null);
  assert.equal(r.eventCount, 8);
});

test('reduceTimeline: no send stamp yields null intervals, never a guessed anchor', () => {
  const r = reduceTimeline(FEED, { turnId: 't1' });
  assert.equal(r.uiFirstTextMs, null);
  assert.equal(r.firstTextWallMs, 102_400);
});

test('reduceTimeline: a turn with no text delta says so instead of substituting', () => {
  const r = reduceTimeline([ev({ perfNow: 50, kind: 'started' }), ev({ perfNow: 900, cliType: 'result', isResult: true, isError: true })], { turnId: 't1', sendPerfNow: 0 });
  assert.equal(r.uiFirstTextMs, null);
  assert.equal(r.unmeasured, 'no-visible-text-delta');
  assert.equal(r.uiFinishedMs, 900);
  assert.equal(r.errored, true);
});

test('turnIdsInSession: first-seen order, per session', () => {
  assert.deepEqual(turnIdsInSession(FEED, 'conv1'), ['t1', 't2']);
  assert.deepEqual(turnIdsInSession(FEED, 'other'), []);
});

test('pctl: nearest rank, ignores non-numbers, null on empty', () => {
  assert.equal(pctl([5, 1, 3, null, undefined, 'x'], 50), 3);
  assert.equal(pctl([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90), 100);
  assert.equal(pctl([], 50), null);
});

const row = (over) => ({
  setup: 'main:claude:claude-opus-5:low', engine: 'claude', model: 'claude-opus-5', effort: 'low', rep: 1, scenario: 'A', turn: 'A',
  uiFirstTextMs: null, ledgerFirstTextMs: null, durationMs: null, toolsUsed: [], researchDispatched: null,
  jobStillRunningAtFirstToken: null, followupLatencyMs: null, error: null, timedOut: false, skipped: false, ...over,
});

test('rowKey / dedupeRows: last row per (setup, rep, scenario, turn) wins', () => {
  const a = row({ uiFirstTextMs: 100 });
  const b = row({ uiFirstTextMs: 200 });
  assert.equal(rowKey(a), 'main:claude:claude-opus-5:low|1|A|A');
  const d = dedupeRows([a, b]);
  assert.equal(d.length, 1);
  assert.equal(d[0].uiFirstTextMs, 200);
});

test('aggregate: per setup x scenario, skipped and timed-out rows never enter a latency series', () => {
  const rows = [
    row({ rep: 1, uiFirstTextMs: 1000, ledgerFirstTextMs: 900, durationMs: 5000 }),
    row({ rep: 2, uiFirstTextMs: 3000, ledgerFirstTextMs: 2800, durationMs: 9000, toolsUsed: ['WebSearch'] }),
    row({ rep: 3, timedOut: true, error: 'turn exceeded 300 s' }),
    row({ scenario: 'B', turn: 'B', rep: 1, uiFirstTextMs: 1500, durationMs: 4000, researchDispatched: true }),
    row({ scenario: 'B', turn: 'B2', rep: 1, uiFirstTextMs: 800, jobStillRunningAtFirstToken: true }),
    row({ scenario: 'B', turn: 'B_followup', rep: 1, followupLatencyMs: 2200 }),
    row({ scenario: 'B', turn: 'B', rep: 2, uiFirstTextMs: 1700, durationMs: 4200, researchDispatched: false, toolsUsed: ['WebFetch'] }),
    row({ scenario: 'B', turn: 'B2', rep: 2, uiFirstTextMs: 700, jobStillRunningAtFirstToken: null }),
    row({ setup: 'main:grok:grok-4.6:low', engine: 'grok', model: 'grok-4.6', skipped: true }),
  ];
  const agg = aggregate(rows);
  assert.deepEqual(agg.map((a) => `${a.setup}/${a.scenario}`), ['main:claude:claude-opus-5:low/A', 'main:claude:claude-opus-5:low/B', 'main:grok:grok-4.6:low/A']);
  const [a, b, g] = agg;
  assert.equal(a.attempts, 3);
  assert.equal(a.n, 2);
  assert.equal(a.timedOut, 1);
  assert.equal(a.p50UiFirstText, 3000);
  assert.equal(a.p50LedgerFirstText, 2800);
  assert.equal(a.p90Total, 9000);
  assert.deepEqual(a.tools, ['WebSearch']);
  assert.equal(b.researchDispatched, 1);
  assert.equal(b.attempts, 2);
  assert.equal(b.b2N, 2);
  assert.equal(b.b2AnsweredWhileRunning, 1);
  assert.equal(b.p50B2FirstText, 800);
  assert.equal(b.followupN, 1);
  assert.equal(b.p50Followup, 2200);
  assert.equal(g.skipped, 1);
  assert.equal(g.n, 0);
  assert.equal(g.p50UiFirstText, null);
});

test('renderReport: one table row per cell, notes and errors surfaced, n/a for scenario A research columns', () => {
  const md = renderReport([
    row({ uiFirstTextMs: 1000, ledgerFirstTextMs: 900, durationMs: 5000, note: 'page load is not observable; fixed 1500 ms settle' }),
    row({ scenario: 'B', turn: 'B', rep: 1, error: 'harness: boom' }),
  ], { generatedAt: '2026-09-18T00:00:00.000Z' });
  assert.match(md, /Generated 2026-09-18T00:00:00.000Z/);
  assert.match(md, /\| main:claude:claude-opus-5:low \| A \| 1 \| 1 \| 0 \| 0 \| 0 \| 1\.0s \/ 1\.0s \(1\/1\) \| 0\.9s \/ 0\.9s \| 5\.0s \/ 5\.0s \| none \| n\/a \| n\/a \| n\/a \| n\/a \|/);
  assert.match(md, /fixed 1500 ms settle/);
  assert.match(md, /## Errors \(1\)/);
  assert.match(md, /harness: boom/);
});
