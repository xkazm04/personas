// @vitest-environment node
/**
 * PORTED from bp scripts/check-release-train.ts @ 48171a1 (spark one-control, Stage 2, WP4b): the release train's pure
 * helpers (compare.ts, release.ts) on hand-built snapshots:
 *   - compareOf mirrors store.mjs `compare`: the item's before/after readings ordered (lens, metric, measured_at, id),
 *     shots paired by (theme, size) with the latest capture of each phase, readings of other items left out;
 *   - the verdict: moved / flat / worse / unmeasured from the lens field's `better` (the manifest), else the sign of the
 *     expected delta; no metric or a missing side is unmeasured; baseline runs compare against their median and noise;
 *   - packItems, releaseItems, unreleased and packGroups (counts per status per pack, as store.mjs `packs` reports them);
 *   - the version suggestion (references/release.md): tag + patch/minor bump, the manifest version, 0.1.0, a taken version.
 * NOT ported here: bp's "an after reading is never the feature's current state" cases, which test bp's derive.ts and
 * live.ts (not part of the Personas port). The blueprint's own reading of that rule (work.ts `series` skips phased
 * readings) is held by src/features/decision-center/blueprint/__tests__/triage.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_MS, awaitingTriage, betterOf, compareOf, packGroups, packItems, releaseItems, runStats, unreleased, type LensFields } from '../compare';
import { RELEASE_ID, bump, bumpOf, isVersion, suggestVersion } from '../release';
import { emptyScan, type Measurement, type Pack, type Proposal, type Release, type ScanSnapshot, type Shot } from '../wire';

const T = (h: number, m = 0) => `2026-10-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
let mid = 0, sid = 0;
const ms = (feature: string, lens: string, metric: string, value: number, at: string, link?: { p: string; phase: 'before' | 'after' }): Measurement =>
  ({ id: ++mid, run_id: 'r1', feature, lens, metric, value, measured_at: at, ...(link ? { proposal_id: link.p, phase: link.phase } : {}) });
const shot = (p: string, phase: 'before' | 'after' | undefined, at: string, theme?: string, size?: string): Shot =>
  ({ id: ++sid, run_id: 'r1', feature: 'f1', path: `shots/r1/${sid}.png`, captured_at: at, ...(theme ? { theme } : {}), ...(size ? { size } : {}), ...(phase ? { proposal_id: p, phase } : {}) });
const prop = (id: string, o: Partial<Proposal> = {}): Proposal =>
  ({ id, run_id: 'r1', feature: 'f1', lens: 'dev', metric: 'cov', title: id, standard: 'none', kind: 'fix', status: 'done', created_at: T(1), updated_at: T(1), ...o });
const pack = (id: string, lens: string): Pack => ({ id, lens, n: 1, branch: 'pack/' + id.slice(2), base_ref: 'main', base_sha: 'abc', status: 'open', created_at: T(1), updated_at: T(1) });

const LENSES: LensFields[] = [
  { id: 'dev', manifest: { fields: [{ key: 'cov', metric: { better: 'up' } }, { key: 'dupSites', metric: { better: 'down' } }, { key: 'loc' }] } },
];

describe('compareOf (bp check-release-train)', () => {
  const scan: ScanSnapshot = {
    ...emptyScan(),
    proposals: [prop('p1'), prop('p2', { metric: 'dupSites' }), prop('p3', { metric: 'cov' }), prop('p4', { metric: undefined }), prop('p5', { metric: 'loc', expected_delta: -50 }), prop('p6', { metric: 'loc' }), prop('p7')],
    measurements: [
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p1', phase: 'before' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p1', phase: 'before' }),
      ms('f1', 'dev', 'cov', 55, T(3), { p: 'p1', phase: 'before' }), // a later before wins
      ms('f1', 'dev', 'cov', 70, T(5), { p: 'p1', phase: 'after' }),
      ms('f1', 'dev', 'cov', 60, T(4), { p: 'p1', phase: 'after' }), // stored out of order: the later one (70) wins
      ms('f1', 'dev', 'cov', 99, T(6), { p: 'p9', phase: 'after' }), // another item's
      ms('f1', 'dev', 'cov', 40, T(7)), // unlinked
      ms('f1', 'dev', 'dupSites', 4, T(2), { p: 'p2', phase: 'before' }),
      ms('f1', 'dev', 'dupSites', 6, T(4), { p: 'p2', phase: 'after' }),
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p3', phase: 'before' }),
      ms('f1', 'dev', 'cov', 50, T(4), { p: 'p3', phase: 'after' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p5', phase: 'before' }),
      ms('f1', 'dev', 'loc', 800, T(4), { p: 'p5', phase: 'after' }),
      ms('f1', 'dev', 'loc', 900, T(2), { p: 'p6', phase: 'before' }),
      ms('f1', 'dev', 'loc', 800, T(4), { p: 'p6', phase: 'after' }),
      ms('f1', 'dev', 'cov', 50, T(2), { p: 'p7', phase: 'before' }),
    ],
    shots: [
      shot('p1', 'before', T(2), 'dark', '1280'),
      shot('p1', 'after', T(4), 'dark', '1280'),
      shot('p1', 'after', T(5), 'dark', '1280'), // the latest after of (dark, 1280)
      shot('p1', 'before', T(2), 'light', '1280'),
      shot('p1', 'after', T(4)), // no theme or size: its own pair
      shot('p1', undefined, T(4), 'dark', '1280'), // a plain shot: not evidence
      shot('p2', 'after', T(4), 'dark', '1280'),
    ],
  };
  const c = compareOf(scan, 'p1', LENSES)!;

  it('orders the before readings (lens, metric, measured_at, id) and keeps the after readings of this item only', () => {
    expect(c.before.map((m) => m.metric + '=' + m.value).join()).toBe('cov=50,cov=55,loc=900');
    expect(c.after.map((m) => m.value).join()).toBe('60,70');
  });

  it('names the verdict and the readings it compares (cov better up, 55 -> 70 moved)', () => {
    expect(c.verdict).toBe('moved');
    expect(c.from?.value).toBe(55);
    expect(c.to?.value).toBe(70);
  });

  it('pairs shots by (theme, size), the latest of each phase; plain shots and other items are left out', () => {
    const pairs = c.shots.map((s) => `${s.theme ?? '-'}/${s.size ?? '-'}:${s.before?.id ?? '-'}>${s.after?.id ?? '-'}`).join(' ');
    expect(pairs).toBe('dark/1280:1>3 light/1280:4>- -/-:->5');
    expect('theme' in c.shots[2]!).toBe(false);
    expect('size' in c.shots[2]!).toBe(false);
  });

  it('verdicts: worse, flat, unmeasured (no metric, no direction, no after), the expected delta as direction', () => {
    expect(compareOf(scan, 'p2', LENSES)?.verdict).toBe('worse');
    expect(compareOf(scan, 'p3', LENSES)?.verdict).toBe('flat');
    expect(compareOf(scan, 'p4', LENSES)?.verdict).toBe('unmeasured');
    expect(compareOf(scan, 'p5', LENSES)?.verdict).toBe('moved');
    expect(compareOf(scan, 'p6', LENSES)?.verdict).toBe('unmeasured');
    const p7 = compareOf(scan, 'p7', LENSES);
    expect(p7?.verdict).toBe('unmeasured');
    expect(p7?.from).toBeUndefined();
    expect(compareOf(scan, 'nope')).toBeNull();
  });

  it('betterOf reads the manifest; a field that is not a metric has no direction', () => {
    expect(betterOf(LENSES, 'dev', 'cov')).toBe('up');
    expect(betterOf(LENSES, 'dev', 'loc')).toBeUndefined();
    expect(betterOf(undefined, 'dev', 'cov')).toBeUndefined();
  });
});

describe('baseline runs: the after against the runs\' median, a change within their noise reads flat', () => {
  const PERF: LensFields[] = [{ id: 'perf', manifest: { fields: [{ key: 'p95', metric: { better: 'down' } }] } }];
  const runs = (p: string, before: number[], after: number) => [
    ...before.map((v, i) => ({ ...ms('f1', 'perf', 'p95', v, T(2, i), { p, phase: 'before' }), unit: 'ms' })),
    { ...ms('f1', 'perf', 'p95', after, T(4), { p, phase: 'after' }), unit: 'ms' },
  ];
  const scan: ScanSnapshot = {
    ...emptyScan(),
    proposals: ['a', 'b', 'c', 'd'].map((id) => prop(id, { lens: 'perf', metric: 'p95' })),
    measurements: [...runs('a', [80, 88, 80], 64), ...runs('b', [80, 184, 80], 88), ...runs('c', [96, 104, 98], 72), ...runs('d', [80], 76)],
  };

  it('runStats: median, spread, noise = max(spread, one frame) for ms; no floor for another unit or one run', () => {
    expect(runStats([80, 88, 80], 'ms')).toEqual({ runs: [80, 80, 88], median: 80, spread: 8, noise: FRAME_MS });
    expect(runStats([3, 3], 'states').noise).toBe(0);
    expect(runStats([80], 'ms').noise).toBe(0);
  });

  it('80/88/80 -> 64 and 80/184/80 -> 88 are flat; 96/104/98 -> 72 moved; one run 80 -> 76 moved', () => {
    expect(compareOf(scan, 'a', PERF)?.verdict).toBe('flat');
    expect(compareOf(scan, 'b', PERF)?.verdict).toBe('flat');
    expect(compareOf(scan, 'c', PERF)?.verdict).toBe('moved');
    expect(compareOf(scan, 'd', PERF)?.verdict).toBe('moved');
  });
});

describe('packs and releases', () => {
  const rel: Release = { id: 'rel-1.0.0', version: '1.0.0', branch: 'release/1.0.0', status: 'draft', created_at: T(1), updated_at: T(1) };
  const scan: ScanSnapshot = {
    ...emptyScan(),
    packs: [pack('k-dev-1', 'dev'), pack('k-sec-1', 'sec'), pack('k-dev-2', 'dev')],
    releases: [rel],
    proposals: [
      prop('b2', { pack_id: 'k-dev-1', status: 'accepted', release_id: 'rel-1.0.0', created_at: T(2) }),
      prop('b1', { pack_id: 'k-dev-1', status: 'done', created_at: T(2) }),
      prop('b3', { pack_id: 'k-dev-1', status: 'failed', created_at: T(1) }),
      prop('b4', { pack_id: 'k-sec-1', lens: 'sec', status: 'accepted', created_at: T(3) }),
      prop('b5', { pack_id: 'k-sec-1', lens: 'sec', status: 'descoped', created_at: T(3) }),
      prop('b6', { status: 'proposed' }),
    ],
  };

  it('packItems orders by created_at then id; releaseItems; unreleased is accepted with no release', () => {
    expect(packItems(scan, 'k-dev-1').map((p) => p.id).join()).toBe('b3,b1,b2');
    expect(releaseItems(scan, 'rel-1.0.0').map((p) => p.id).join()).toBe('b2');
    expect(unreleased(scan).map((p) => p.id).join()).toBe('b4');
  });

  it('packGroups: every pack in snapshot order with its counts per status; by lens; awaitingTriage = done + failed', () => {
    const g = packGroups(scan);
    expect(g.map((x) => x.pack.id).join()).toBe('k-dev-1,k-sec-1,k-dev-2');
    expect(Object.keys(g[2]!.counts)).toHaveLength(0);
    expect(JSON.stringify(g[0]!.counts)).toBe('{"failed":1,"done":1,"accepted":1}');
    expect(JSON.stringify(g[1]!.counts)).toBe('{"accepted":1,"descoped":1}');
    expect(packGroups(scan, 'sec').map((x) => x.pack.id).join()).toBe('k-sec-1');
    expect(awaitingTriage(g[0]!)).toBe(2);
    expect(awaitingTriage(g[1]!)).toBe(0);
  });
});

describe('the version suggestion', () => {
  const fix = { kind: 'fix' as const }, up = { kind: 'baseline-upgrade' as const }, cap = { kind: 'fix' as const, body: 'Summary\ncapability: new\n' };

  it('bumpOf: fixes patch, a baseline-upgrade or `capability: new` minor; bump drops a pre-release', () => {
    expect([bumpOf([fix, fix]), bumpOf([fix, up]), bumpOf([cap]), bumpOf([])]).toEqual(['patch', 'minor', 'minor', 'patch']);
    expect([bump('1.4.0', 'patch'), bump('1.4.3', 'minor'), bump('2.0.0-beta.1', 'patch')]).toEqual(['1.4.1', '1.5.0', '2.0.1']);
  });

  it('from the latest tag, minor with a baseline-upgrade, a tag that is not semver passed over', () => {
    const s1 = suggestVersion(['v1.4.0', 'v1.3.9'], { version: '9.9.9', file: 'package.json' }, [fix]);
    expect([s1.version, s1.from]).toEqual(['1.4.1', 'v1.4.0']);
    expect(suggestVersion(['v1.4.0'], undefined, [fix, up]).version).toBe('1.5.0');
    expect(suggestVersion(['vNext', 'v0.3.0'], undefined, [fix]).version).toBe('0.3.1');
  });

  it('no tag: the manifest version as it stands; nothing: 0.1.0 from none; a taken version is passed over', () => {
    const s2 = suggestVersion([], { version: '2.3.0', file: 'src-tauri/Cargo.toml' }, [up]);
    expect([s2.version, s2.from]).toEqual(['2.3.0', 'src-tauri/Cargo.toml']);
    expect(JSON.stringify(suggestVersion([], undefined, []))).toContain('"version":"0.1.0","from":"none"');
    const s3 = suggestVersion(['v1.4.0'], undefined, [fix], new Set(['1.4.1', '1.4.2']));
    expect(s3.version).toBe('1.4.3');
    expect(s3.reason).toMatch(/already has a release/);
  });

  it('isVersion and RELEASE_ID', () => {
    expect([isVersion('1.4.1'), isVersion('1.0.0-rc.1'), isVersion('v1.4.1'), isVersion('1.4')]).toEqual([true, true, false, false]);
    expect([RELEASE_ID.test('rel-1.4.1'), RELEASE_ID.test('rel-1.4.1;x'), RELEASE_ID.test('1.4.1')]).toEqual([true, false, false]);
  });
});
