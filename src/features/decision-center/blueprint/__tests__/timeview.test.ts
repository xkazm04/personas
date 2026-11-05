// @vitest-environment node
/**
 * Replayed health (model/timeview.ts healthAsOf / replayTable) and the engine's index over it (engine/replay.ts), held
 * by bp's own cases: bp scripts/check-timeview.ts @ 93f30b0 "replayed health" section (its lensAsOf assertions are
 * read through healthAsOf, which lensAsOf wraps; bp's label is re-composed from `readings` / `upTo`), and the pure half
 * of bp scripts/check-replay-flags.ts (no scan: nothing replayed; a reading over the rule flags the date it is in
 * force, a later good one clears it; at now nothing; the version moves on a rebuild only). The Engine half of
 * check-replay-flags (frames, raster key, camera) is WP2's.
 */
import { describe, expect, it } from 'vitest';
import { healthAsOf, metricHistory, replayTable, type HealthReplay } from '../model/timeview';
import { ReplayIndex } from '../engine/replay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const NOW = '2026-10-31';
const lat = { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'static', better: 'lower' } };
const mk = (rules: Any[], extra: Any[] = []) => ({ fields: [lat, ...extra], health: { default: 'good', rules } });
const gt = { when: { field: 'latency', gt: 100 }, health: 'bad', reason: 'Latency {latency} ms is over 100' };
const dl: Any = { id: 'l', name: 'L', headline: lat, manifest: mk([gt]) };
// the enum is judged by hand (no history): its lens cannot be replayed even with latency readings
const de: Any = { id: 'e', name: 'E', headline: null, manifest: mk([{ when: { field: 'grade', eq: 'poor' }, health: 'bad', reason: 'Graded poor' }, gt], [{ key: 'grade', label: 'Grade', type: 'enum', values: ['poor', 'fine'] }]) };
// a stage-bound rule reads the stage of THAT date (beta until 10-15), not today's (live)
const ds: Any = { id: 's', name: 'S', headline: lat, manifest: mk([{ when: { all: [{ field: 'stage', eq: 'live' }, { field: 'latency', gt: 100 }] }, health: 'bad', reason: 'Live and slow' }], [{ key: 'stage', label: 'Stage', type: 'enum', values: ['beta', 'live'], source: { feature: 'stage' } }]) };
const r = (id: number, lens: string, at: string, value: number, x: Any = {}) => ({ id, run_id: 'r', feature: 'f', lens, metric: 'latency', value, measured_at: at + 'T10:00:00Z', ...x });
const rscan: Any = { measurements: [
  r(1, 'l', '2026-10-01', 120), r(2, 'l', '2026-10-20', 60), r(3, 'l', '2026-10-05', 50, { phase: 'after', proposal_id: 'p' }),
  r(4, 'e', '2026-10-01', 120), r(5, 'e', '2026-10-20', 60), r(6, 's', '2026-10-01', 120),
] };
// today: held good by an override, the facet's current value 60, and the lens marked not applicable on another pair
const ov = { health: 'good', until: '2026-12-31', by: 'owner', why: 'accepted' };
const rf: Any = { id: 'f', name: 'F', stage: 'live', revs: [{ stage: 'beta', date: '2026-09-01' }, { stage: 'live', date: '2026-10-15' }], health: 'good', trouble: [],
  lens: { l: { h: 'good', why: null, ov, whyFields: [], facet: { values: { latency: 60 }, override: ov } }, e: { h: 'good', facet: { applicable: false } }, s: { h: 'good', facet: { values: { latency: 60 } } } } };
const ha = (d: Any, t: string) => healthAsOf(rf, d, rscan, t, NOW);
/** bp's label, from the data it was made of. */
const label = (h: HealthReplay) => "replayed by today's rules from " + h.readings + ' reading' + (h.readings === 1 ? '' : 's') + ' up to ' + h.upTo;

describe('healthAsOf (bp check-timeview, replayed health)', () => {
  it("replay at 10-10: 120 (10-01) against 'gt 100 -> bad' reads bad with the rule's reason and the label's data", () => {
    const a = ha(dl, '2026-10-10')!;
    expect(a.health).toBe('bad');
    expect(a.why).toBe('Latency 120 ms is over 100');
    expect(label(a)).toBe("replayed by today's rules from 1 reading up to 2026-10-01");
    expect(a.values.latency).toBe(120);
  });
  it('replay at 10-25: 60 (10-20) reads good', () => {
    const b = ha(dl, '2026-10-25')!;
    expect(b.health).toBe('good');
    expect(b.why).toBeNull();
    expect(label(b)).toBe("replayed by today's rules from 1 reading up to 2026-10-20");
  });
  it("the current good override and the facet's current 60 do not reach the replay; an after reading never counts", () => {
    expect(ha(dl, '2026-10-10')!.health).toBe('bad');
    expect(ha(dl, '2026-10-06')!.values.latency).toBe(120);
  });
  it('before the first reading: nothing to replay, not recorded', () => { expect(ha(dl, '2026-09-20')).toBeNull(); });
  it('a lens whose rule reads an enum field stays not recorded on both dates', () => {
    expect(ha(de, '2026-10-10')).toBeNull();
    expect(ha(de, '2026-10-25')).toBeNull();
  });
  it('a stage-bound rule reads the replayed stage: beta on 10-10 (good), live on 10-20 (bad)', () => {
    expect(ha(ds, '2026-10-10')!.health).toBe('good');
    expect(ha(ds, '2026-10-20')!.health).toBe('bad');
  });
  it('at now nothing is replayed', () => { expect(ha(dl, NOW)).toBeNull(); });
  it('replayTable on 10-10: f -> {l: bad, s: good}, no entry for the enum lens; null at now', () => {
    const tab = replayTable([rf], [dl, de, ds], rscan, '2026-10-10', NOW)!;
    expect(tab.get('f')!.get('l')).toBe('bad');
    expect(tab.get('f')!.get('s')).toBe('good');
    expect(tab.get('f')!.has('e')).toBe(false);
    expect(replayTable([rf], [dl], rscan, NOW, NOW)).toBeNull();
  });
  it('metricHistory leaves the after readings out and sorts oldest first', () => {
    expect(metricHistory(rscan, 'f', 'l', 'latency').map((m) => m.id)).toEqual([1, 2]);
  });
});

describe('ReplayIndex (bp check-replay-flags, pure half)', () => {
  it('with no scan a past date replays nothing', () => {
    const ix = new ReplayIndex([rf], [dl, de, ds]);
    expect(ix.sync('2026-10-10', NOW, undefined)).toBe(true);
    expect(ix.pairs).toBe(0);
    expect(ix.troubled).toHaveLength(0);
    expect(ix.row('f')).toBeNull();
  });
  it('the date a bad reading is in force flags the feature under that lens; a later good one clears it; now holds nothing', () => {
    const ix = new ReplayIndex([rf], [dl, de, ds]);
    ix.sync('2026-10-10', NOW, rscan);
    expect(ix.pairs).toBe(2);
    expect(ix.troubled.map((x) => x.f.id)).toEqual(['f']);
    const row = ix.row('f')!;
    expect(row.trouble).toEqual([{ lens: 'l', h: 'bad' }]);
    expect(row.health).toBe('bad');
    expect(ix.healthUnder(row, 'general')).toBe('bad');
    expect(ix.healthUnder(row, 's')).toBe('good');
    expect(ix.healthUnder(row, 'e')).toBe('unmeasured');
    // 10-25: l's 60 (10-20) clears it; s now reads the replayed stage live over its only reading, 120: live and slow
    ix.sync('2026-10-25', NOW, rscan);
    expect(ix.row('f')!.trouble).toEqual([{ lens: 's', h: 'bad' }]);
    expect(new ReplayIndex([rf], [dl]).sync('2026-10-25', NOW, rscan) && ix.healthUnder(ix.row('f')!, 'l')).toBe('good');
    ix.sync(NOW, NOW, rscan);
    expect(ix.pairs).toBe(0);
    expect(ix.row('f')).toBeNull();
  });
  it('rebuilds only on a new (date, scan): the version moves with each rebuild and not otherwise', () => {
    const ix = new ReplayIndex([rf], [dl]);
    expect(ix.sync('2026-10-10', NOW, rscan)).toBe(true);
    const v = ix.version;
    expect(ix.sync('2026-10-10', NOW, rscan)).toBe(false);
    expect(ix.version).toBe(v);
    expect(ix.sync('2026-10-10', NOW, { ...rscan })).toBe(true);
    expect(ix.version).toBe(v + 1);
  });
});
