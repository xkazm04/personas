/**
 * What changed between two reads (/perfect wave 2, direction 6): the pure diff, and the one-shot highlight schedule.
 */
import { describe, expect, it } from 'vitest';
import { diffScan, featureOf, proposalOf } from '../model/changes';
import { FLASH_MS, Flashes } from '../engine/changed';
import { kettleScan } from '../fixture/kettle';

describe('diffScan', () => {
  it('two identical scans (the same object or a re-delivered copy) change nothing', () => {
    const a = kettleScan();
    expect(diffScan(a, a)).toEqual([]);
    expect(diffScan(a, kettleScan())).toEqual([]);
  });

  it('a proposal whose status moved names the id, the feature and both statuses', () => {
    const a = kettleScan(), b = kettleScan();
    const p = b.proposals.find((x) => x.status === 'proposed')!;
    p.status = 'approved';
    const out = diffScan(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'status', id: p.id, fid: p.feature, from: 'proposed', to: 'approved', key: `p:${p.id}:approved` });
    expect(featureOf(out[0]!)).toBe(p.feature);
    expect(proposalOf(out[0]!)).toBe(p.id);
  });

  it('a proposal that was not there is new, with the status it arrived in', () => {
    const a = kettleScan(), b = kettleScan();
    b.proposals.push({ ...b.proposals[0]!, id: 'p-new', status: 'proposed', title: 'Fresh finding' });
    expect(diffScan(a, b)).toEqual([expect.objectContaining({ kind: 'proposed', id: 'p-new', title: 'Fresh finding', status: 'proposed', key: 'p:p-new:new' })]);
  });

  it('a run that was running and ended is one entry; a run still running is none; a new run is one', () => {
    const a = kettleScan();
    a.runs[0]!.status = 'running';
    const same = kettleScan(); same.runs[0]!.status = 'running';
    expect(diffScan(a, same)).toEqual([]);
    const ended = kettleScan(); ended.runs[0]!.status = 'failed';
    expect(diffScan(a, ended)).toEqual([expect.objectContaining({ kind: 'run', id: a.runs[0]!.id, from: 'running', to: 'failed' })]);
    const b = kettleScan();
    b.runs.push({ ...b.runs[0]!, id: 'r-new', status: 'running' });
    expect(diffScan(kettleScan(), b)).toEqual([expect.objectContaining({ kind: 'run', id: 'r-new', from: null, to: 'running', key: 'r:r-new:new' })]);
  });

  it('new readings are counted per feature and lens; the before/after captures of a proposal are not readings', () => {
    const a = kettleScan(), b = kettleScan();
    const top = Math.max(...b.measurements.map((m) => m.id));
    const { phase: _phase, ...base } = b.measurements[0]!;
    for (let i = 1; i <= 3; i++) b.measurements.push({ ...base, id: top + i, feature: 'book-a-class', lens: 'design' });
    b.measurements.push({ ...base, id: top + 4, feature: 'card-payments', lens: 'design' });
    b.measurements.push({ ...base, id: top + 5, feature: 'card-payments', lens: 'design', phase: 'after' });
    const out = diffScan(a, b).filter((c) => c.kind === 'readings');
    expect(out).toEqual([
      expect.objectContaining({ fid: 'book-a-class', lens: 'design', count: 3, key: `m:book-a-class:design:${top + 3}` }),
      expect.objectContaining({ fid: 'card-payments', lens: 'design', count: 1 }),
    ]);
  });
});

describe('Flashes', () => {
  it('is idle with nothing to show: no frame is asked for', () => {
    const f = new Flashes();
    expect(f.step(0)).toBe(false);
    expect(f.step(10_000)).toBe(false);
  });

  it('asks for frames while a mark decays, once more to erase it, then goes idle', () => {
    const f = new Flashes();
    f.add(['a', 'b']);
    let frames = 0;
    for (let t = 1000; t < 1000 + FLASH_MS + 400; t += 16) if (f.step(t)) frames++;
    expect(frames).toBeGreaterThan(100);
    expect(frames).toBeLessThanOrEqual(Math.ceil(FLASH_MS / 16) + 2);
    expect(f.size).toBe(0);
    expect(f.step(1000 + FLASH_MS + 500)).toBe(false);
  });

  it('fades from full to nothing; reduced motion holds it at full strength for the same time', () => {
    const f = new Flashes();
    f.add(['a']);
    f.step(0);
    expect(f.strength('a', 0, false)).toBe(1);
    expect(f.strength('a', FLASH_MS / 2, false)).toBeLessThan(0.5);
    expect(f.strength('a', FLASH_MS / 2, true)).toBe(1);
    expect(f.strength('a', FLASH_MS, true)).toBe(0);
    expect(f.strength('nope', 0, false)).toBe(0);
  });

  it('a second flash of the same feature restarts it', () => {
    const f = new Flashes();
    f.add(['a']); f.step(0);
    f.step(FLASH_MS - 100);
    f.add(['a']); f.step(FLASH_MS);
    expect(f.size).toBe(1);
    f.step(FLASH_MS + 200);
    expect(f.strength('a', FLASH_MS + 200, true)).toBe(1);
  });
});
