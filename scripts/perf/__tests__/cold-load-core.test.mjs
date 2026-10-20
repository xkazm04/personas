// Run: node --test scripts/perf/__tests__/cold-load-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNavRegistry,
  parseNavCatalog,
  deriveSurfaces,
  sequentialDepth,
  evaluateBar,
  rankRows,
  renderScorecard,
} from '../lib/cold-load-core.mjs';
import { loadSurfaces } from '../cold-load-probe.mjs';
import { installColdProbe } from '../lib/cold-load-page.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const REGISTRY = `
export const NAV_SECTIONS: readonly NavSectionEntry[] = [
  { id: 'home', label: 'Home', labelKey: 'home', icon: Home, gates: {}, reachability: 'sidebar' },
  { id: 'teams', label: 'Projects', labelKey: 'teams', icon: Users, gates: { minTier: TIERS.TEAM }, reachability: 'sidebar' },
  { id: 'studio', label: 'Studio', labelKey: 'studio', icon: PenTool, gates: { devOnly: true }, reachability: 'nested', parent: 'teams' },
  { id: 'schedules', label: 'Schedules', labelKey: 'schedules', icon: CalendarClock, gates: {}, reachability: 'overlay-only' },
] as const;`;

const CATALOG = `
const HOME_TABS = exact<HomeTab>({ welcome: true, 'system-check': true });
const TEAMS_TABS = exact<TeamsTab>({ workspace: true, goals: true });
const GOALS_TABS = exact<GoalsView>({ notes: true, ledger: true });
export const TAB_DIMENSIONS: readonly TabDimension[] = [
  { key: 'homeTab', store: 'system', section: 'home', values: HOME_TABS },
  { key: 'teamsTab', store: 'system', section: 'teams', values: TEAMS_TABS },
  { key: 'goalsView', store: 'system', section: 'teams', values: GOALS_TABS },
];`;

test('registry parse keeps reachability, gates and parent', () => {
  const rows = parseNavRegistry(REGISTRY);
  assert.deepEqual(rows.map((r) => r.id), ['home', 'teams', 'studio', 'schedules']);
  assert.equal(rows[1].minTier, 'team');
  assert.equal(rows[2].devOnly, true);
  assert.equal(rows[2].parent, 'teams');
});

test('a registry the matcher cannot read fails loud instead of yielding zero surfaces', () => {
  assert.throws(() => parseNavRegistry('export const NAV_SECTIONS = [] as const'), /zero rows/);
  assert.throws(() => parseNavCatalog('export const TAB_DIMENSIONS = [];', null), /zero rows/);
});

test('surfaces: one per tab, nested dimension replaces its host tab, overlay sections skipped', () => {
  const { surfaces } = deriveSurfaces(parseNavRegistry(REGISTRY), parseNavCatalog(CATALOG, null));
  assert.deepEqual(surfaces.map((s) => s.id), [
    'home/welcome',
    'home/system-check',
    'teams/workspace',
    'teams/goals/notes',
    'teams/goals/ledger',
    'studio',
  ]);
  const ledger = surfaces.find((s) => s.id === 'teams/goals/ledger');
  assert.deepEqual(ledger.sets.map((x) => `${x.key}=${x.value}`), ['teamsTab=goals', 'goalsView=ledger']);
});

test('the real registry derives every catalog dimension with a reach rule', () => {
  const { surfaces, unreachedDimensions } = loadSurfaces(REPO);
  assert.ok(surfaces.length >= 60, `only ${surfaces.length} surfaces derived`);
  assert.deepEqual(unreachedDimensions, []);
  assert.ok(surfaces.some((s) => s.id === 'personas/editor/design/brain' && s.needsPersona));
  assert.ok(!surfaces.some((s) => s.section === 'schedules'));
});

test('sequential depth: parallel calls are depth 1, a parent-then-child chain is depth 2+', () => {
  assert.equal(sequentialDepth([]).depth, 0);
  const parallel = [
    { command: 'a', startMs: 0, endMs: 50 },
    { command: 'b', startMs: 1, endMs: 40 },
  ];
  assert.equal(sequentialDepth(parallel).depth, 1);
  const chain = [
    { command: 'list', startMs: 0, endMs: 30 },
    { command: 'detail', startMs: 45, endMs: 80 },
    { command: 'stats', startMs: 10, endMs: 20 },
    { command: 'children', startMs: 95, endMs: 120 },
  ];
  const d = sequentialDepth(chain);
  assert.equal(d.depth, 3);
  assert.deepEqual(d.chain, ['list', 'detail', 'children']);
});

test('bar: unmeasured metrics never fail, measured ones do, rank puts more failures first', () => {
  const good = { id: 'a', cold: { ok: true, chromeMs: 20, contentMs: 300, blankFramesBeyondGrace: 0, cls: 0, ipcSequentialDepth: 1 }, warm: { contentMs: 30 } };
  const bad = { id: 'b', cold: { ok: true, chromeMs: 400, contentMs: 2000, blankFramesBeyondGrace: 3, cls: 0.2, ipcSequentialDepth: null }, warm: null };
  assert.deepEqual(evaluateBar(good).fails, []);
  const v = evaluateBar(bad);
  assert.equal(v.fails.length, 4);
  assert.ok(v.unmeasured.includes('ipcSequentialDepth'));
  assert.ok(v.unmeasured.includes('warmContentMs'));
  const skipped = { id: 'c', cold: { ok: false, reason: 'navigate refused' } };
  assert.deepEqual(rankRows([good, skipped, bad]).map((r) => r.id), ['b', 'a', 'c']);
  const md = renderScorecard({ startedAt: '2026-10-20T00:00:00Z', port: 17320, buildMode: 'dev build', rows: [good, bad, skipped], caveats: ['x'] });
  assert.match(md, /PROPOSAL/);
  assert.match(md, /failing the proposed bar: \*\*1 of 2\*\*/);
  assert.match(md, /`c`: navigate refused/);
});

test('the page instrument stringifies to self-contained JS (no imports, no TS)', () => {
  const src = installColdProbe.toString();
  assert.ok(src.startsWith('function installColdProbe'));
  assert.doesNotThrow(() => new Function(`(${src})`));
  assert.ok(!/\bimport\s+[\w{]/.test(src), 'static import inside the injected function');
  for (const m of ['coldProbeVersion', 'coldProbeCapture', 'coldProbeRestore', 'coldProbeMeasure']) assert.ok(src.includes(`T.${m} = function ${m}(`), m);
});
