import { describe, expect, it } from 'vitest';
import { buildSpine, type SpineInstance } from './spine';

const inst = (id: string, kinds: string[], outcome: string, opts: { err?: number[]; group?: string } = {}): SpineInstance => ({
  id,
  group: opts.group ?? 'a',
  outcome,
  steps: kinds.map((k, i) => ({ k, t: i * 10, err: opts.err?.includes(i) ? 1 : 0, friction: false })),
});

const fails = (o: string) => o === 'errored' || o === 'interrupted';

describe('buildSpine', () => {
  const cohort: SpineInstance[] = [
    ...Array.from({ length: 6 }, (_, i) => inst(`ok${i}`, ['brief', 'explore', 'edit', 'verify', 'ship'], 'landed')),
    inst('noverify1', ['brief', 'explore', 'edit', 'ship'], 'landed'),
    inst('quit1', ['brief', 'explore'], 'errored'),
    inst('quit2', ['brief', 'explore'], 'interrupted'),
    inst('readonly', ['brief', 'explore'], 'quiet'),
    inst('broke', ['brief', 'explore', 'edit', 'verify'], 'errored', { err: [3] }),
  ];

  it('derives the most-travelled path from the data', () => {
    const m = buildSpine(cohort, fails);
    expect(m.stations.map((s) => s.keys.join('/'))).toEqual(['brief', 'explore', 'edit', 'verify', 'ship']);
  });

  it('counts coverage, skips and exits per station, each instance once', () => {
    const m = buildSpine(cohort, fails);
    const [brief, explore, edit, verify, ship] = m.stations;
    expect(brief?.reached).toBe(11);
    expect(explore?.exits).toBe(2); // two failed after exploring; the clean read-only session is not a failure
    expect(edit?.reached).toBe(8);
    expect(verify?.skipped).toBe(1); // went on to ship without verifying
    expect(verify?.exits).toBe(1);
    expect(verify?.friction).toBe(1);
    expect(ship?.reached).toBe(7);
    expect(m.walkedAll).toBe(6);
    const exits = m.stations.reduce((a, s) => a + s.exits, 0);
    expect(exits).toBe(3); // every failed instance is filed exactly once
  });

  it('files an error on the phase it happened in, not the last station reached', () => {
    const late = inst('late', ['brief', 'explore', 'edit', 'verify', 'ship', 'verify'], 'landed', { err: [5] });
    const m = buildSpine([...cohort, late], fails);
    expect(m.stations[3]?.friction).toBe(2);
    expect(m.stations[4]?.friction).toBe(0);
  });

  it('ranks the stations with the most failures first', () => {
    const m = buildSpine(cohort, fails);
    expect(m.worst[0]).toBe(1); // explore: two exits
    expect(m.worst).toContain(3);
  });

  it('measures a group against the cohort path so stations stay comparable', () => {
    const group = cohort.filter((x) => x.id.startsWith('quit'));
    const m = buildSpine(group, fails, cohort);
    expect(m.stations).toHaveLength(5);
    expect(m.stations[2]?.reached).toBe(0);
  });
});
