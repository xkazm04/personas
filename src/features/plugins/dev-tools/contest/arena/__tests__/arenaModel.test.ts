import { describe, expect, it } from 'vitest';

import { detailFixture, summaryFixture } from '../../__tests__/fixtures';
import {
  buildLanes,
  chainStations,
  elapsedSince,
  lanePosition,
  laneStage,
  makerSpec,
  pickTrackKey,
  raceRounds,
  raceStartMs,
  relevantLayer,
  stepKey,
  recordedBucket,
  trays,
  variantName,
} from '../arenaModel';

describe('raceRounds', () => {
  it('nests refine rounds under their parent, in round order, keeping root order', () => {
    const a = summaryFixture({ contestId: 'a' });
    const b = summaryFixture({ contestId: 'b' });
    const a3 = summaryFixture({ contestId: 'a-r3', parentId: 'a-r2', round: 3 });
    const a2 = summaryFixture({ contestId: 'a-r2', parentId: 'a', round: 2 });
    const out = raceRounds([a3, b, a2, a]).map((e) => `${e.summary.contestId}:${e.depth}`);
    expect(out).toEqual(['b:0', 'a:0', 'a-r2:1', 'a-r3:2']);
  });

  it('keeps an orphan round as a root and survives a parent cycle', () => {
    const orphan = summaryFixture({ contestId: 'x', parentId: 'gone', round: 2 });
    const c1 = summaryFixture({ contestId: 'c1', parentId: 'c2' });
    const c2 = summaryFixture({ contestId: 'c2', parentId: 'c1' });
    const out = raceRounds([orphan, c1, c2]);
    expect(out.map((e) => e.summary.contestId).sort()).toEqual(['c1', 'c2', 'x']);
    expect(out.find((e) => e.summary.contestId === 'x')!.depth).toBe(0);
  });

  it('never nests across projects', () => {
    const parent = summaryFixture({ projectId: 'p1', contestId: 'a' });
    const child = summaryFixture({ projectId: 'p2', contestId: 'a-r2', parentId: 'a', round: 2 });
    expect(raceRounds([parent, child]).map((e) => e.depth)).toEqual([0, 0]);
  });
});

describe('pickTrackKey / relevantLayer', () => {
  it('prefers focus, then the newest live race, then one in review', () => {
    const done = summaryFixture({ contestId: 'done', phase: 'decided' });
    const rev = summaryFixture({ contestId: 'rev', phase: 'review' });
    const live = summaryFixture({ contestId: 'live', phase: 'running' });
    expect(pickTrackKey({ projectId: 'p9', contestId: 'z' }, [live])).toEqual({ projectId: 'p9', contestId: 'z' });
    expect(pickTrackKey(null, [done, rev, live])?.contestId).toBe('live');
    expect(pickTrackKey(null, [done, rev])?.contestId).toBe('rev');
    expect(pickTrackKey(null, [done])).toBeNull();
  });

  it('sends review and shortlisted to the photo finish, everything else to the track', () => {
    expect(relevantLayer('review')).toBe('review');
    expect(relevantLayer('shortlisted')).toBe('review');
    expect(relevantLayer('running')).toBe('track');
    expect(relevantLayer(null)).toBe('track');
  });
});

describe('lanes', () => {
  it('splits racers from stewards and lands each variant in its seat lane', () => {
    const d = detailFixture();
    const judge = { ...d.seats[0]!, seatId: 'judge-1', kind: 'judge' as const, letter: null };
    const { racers, stewards } = buildLanes({ ...d, seats: [...d.seats, judge] });
    expect(racers.map((l) => l.variants.map((v) => v.key))).toEqual([['A/1'], ['B/1']]);
    expect(stewards).toHaveLength(1);
  });

  it('maps states to stages and positions without inventing progress', () => {
    expect(laneStage('queued')).toBe('grid');
    expect(laneStage('seat-limit')).toBe('out');
    expect(lanePosition('queued', null, null)).toBe(0);
    expect(lanePosition('completed', null, null)).toBe(1);
    expect(lanePosition('running', null, 3600)).toBe(0.5);
    expect(lanePosition('running', 900, 3600)).toBe(0.25);
    expect(lanePosition('running', 9999, 3600)).toBe(0.97);
    expect(lanePosition('timed-out', null, null)).toBe(1);
    expect(lanePosition('errored', null, 3600, 1800)).toBe(0.5);
  });

  it('elapsedSince is null for an unknown start', () => {
    expect(elapsedSince(null, 10_000)).toBeNull();
    expect(elapsedSince(0, 10_000)).toBeNull();
    expect(elapsedSince(4_000, 10_000)).toBe(6);
  });
});

describe('chainStations', () => {
  const ids = (st: ReturnType<typeof chainStations>) => st.map((s) => `${s.id}:${s.status}`);

  it('walks collect → visual → stewards → ready', () => {
    expect(ids(chainStations({ step: 'visual' }, true, 'collecting'))).toEqual([
      'collect:done', 'visual:active', 'judges:pending', 'ready:pending',
    ]);
    expect(ids(chainStations({ step: 'ready' }, false, 'review'))).toEqual([
      'collect:done', 'visual:done', 'judges:skipped', 'ready:done',
    ]);
  });

  it('an idle chain is pending while racing and done once the race is past it', () => {
    expect(chainStations({ step: 'idle' }, false, 'running').every((s) => s.status !== 'done')).toBe(true);
    expect(ids(chainStations({ step: 'idle' }, true, 'decided'))).toEqual([
      'collect:done', 'visual:done', 'judges:done', 'ready:done',
    ]);
  });

  it('a failed chain blames the step its reason names, never "Ready for review" (FE-12)', () => {
    const failed = (reason: string | null, judges = true) =>
      ids(chainStations({ step: 'failed', reason }, judges, 'failed'));
    expect(failed('collect: 0 of 2 seats delivered a variant')).toEqual([
      'collect:failed', 'visual:pending', 'judges:pending', 'ready:pending',
    ]);
    expect(failed('visual: playwright exited 1')).toEqual([
      'collect:done', 'visual:failed', 'judges:pending', 'ready:pending',
    ]);
    expect(failed('judge: 2 of 3 judges returned no verdict')).toEqual([
      'collect:done', 'visual:done', 'judges:failed', 'ready:pending',
    ]);
    expect(failed('aggregate: scoreboard.json missing')).toEqual([
      'collect:done', 'visual:done', 'judges:failed', 'ready:pending',
    ]);
    // The instrument's own wording (node::run_instrument) names the step too.
    expect(failed('Internal error: contest collect failed (exit 1): 0 of 2 seats delivered a variant')).toEqual([
      'collect:failed', 'visual:pending', 'judges:pending', 'ready:pending',
    ]);
    expect(failed('visual: no browser', false)).toEqual([
      'collect:done', 'visual:failed', 'judges:skipped', 'ready:pending',
    ]);
  });

  it('a failed chain whose reason names no step blames none', () => {
    const st = chainStations({ step: 'failed', reason: 'Error: EPERM' }, true, 'failed');
    expect(st.some((x) => x.status === 'failed')).toBe(false);
    expect(st.find((x) => x.id === 'ready')?.status).toBe('pending');
  });
});

describe('photo finish helpers', () => {
  it('trays sorts every variant, unsorted by default', () => {
    const d = detailFixture();
    const review = { field: '', variants: [{ key: 'A/1', bucket: 'winner' as const, note: '', pins: [] }] };
    expect(trays(review, d.variants)).toEqual({ winner: ['A/1'], shortlist: [], impractical: [], failure: [], unsorted: ['B/1'] });
    expect(trays(null, d.variants).unsorted).toEqual(['A/1', 'B/1']);
  });

  it('stepKey wraps and recovers from an unknown key', () => {
    expect(stepKey(['A/1', 'B/1'], 'B/1', 1)).toBe('A/1');
    expect(stepKey(['A/1', 'B/1'], 'A/1', -1)).toBe('B/1');
    expect(stepKey(['A/1'], '*', 1)).toBe('A/1');
    expect(stepKey([], null, 1)).toBeNull();
  });

  it('makerSpec names the seat that built a variant', () => {
    const d = detailFixture();
    expect(makerSpec(d, d.variants[1]!)).toBe('codex:gpt-6-sol@high');
    expect(makerSpec(d, { seatId: 'nobody' })).toBeNull();
  });
});

describe('raceStartMs', () => {
  const seat = detailFixture().seats[0]!;
  it('a scheduled start ahead wins, else the earliest seat start, else a past schedule', () => {
    expect(raceStartMs({ notBeforeMs: 5_000, seats: [] }, 1_000)).toEqual({ ms: 5_000, upcoming: true });
    const seats = [{ ...seat, startedAtMs: 3_000 }, { ...seat, startedAtMs: 2_000 }, { ...seat, startedAtMs: null }];
    expect(raceStartMs({ notBeforeMs: 500, seats }, 9_000)).toEqual({ ms: 2_000, upcoming: false });
    expect(raceStartMs({ notBeforeMs: 500, seats: [] }, 9_000)).toEqual({ ms: 500, upcoming: false });
    expect(raceStartMs({ notBeforeMs: null, seats: [] }, 9_000)).toBeNull();
  });
});

describe('variantName', () => {
  it('says the name once: concept, else title, else key', () => {
    expect(variantName({ concept: 'Spotlight', title: 'Studio: Spotlight', key: 'C/1' })).toBe('Spotlight');
    expect(variantName({ concept: ' ', title: 'Studio', key: 'C/1' })).toBe('Studio');
    expect(variantName({ concept: '', title: '', key: 'C/1' })).toBe('C/1');
  });
});

describe('the recorded verdict is the floor (FE-5)', () => {
  const variants = [{ key: 'A/1' }, { key: 'A/2' }, { key: 'B/1' }, { key: 'B/2' }];

  it('a CLI-decided race with no review.json still shows its winner and shortlist', () => {
    const recorded = { winner: 'A/1', shortlist: ['B/2'] };
    expect(trays(null, variants, recorded)).toEqual({
      winner: ['A/1'], shortlist: ['B/2'], impractical: [], failure: [], unsorted: ['A/2', 'B/1'],
    });
    expect(recordedBucket(null, recorded, 'A/1')).toBe('winner');
    expect(recordedBucket(null, recorded, 'A/2')).toBeNull();
  });

  it("the owner's buckets override the recorded verdict", () => {
    const review = { field: '', variants: [{ key: 'A/1', bucket: 'failure' as const, note: '', pins: [] }] };
    const recorded = { winner: 'A/1', shortlist: ['A/1', 'B/2'] };
    const out = trays(review, variants, recorded);
    expect(out.failure).toEqual(['A/1']);
    expect(out.winner).toEqual([]);
    expect(out.shortlist).toEqual(['B/2']);
  });
});
