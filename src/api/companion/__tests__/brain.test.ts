import { describe, expect, it } from 'vitest';
import { parseCycleStats } from '../brain';

describe('parseCycleStats', () => {
  it('reads the snake_case keys the Rust side actually writes', () => {
    // `CycleStats` carries no `rename_all`, so the column is snake_case. A
    // camelCase mirror would silently read `undefined` for every counter.
    const stats = parseCycleStats(
      JSON.stringify({ episodes_in: 7, episodes_available: 9, facts_applied: 3 }),
    );
    expect(stats.episodes_in).toBe(7);
    expect(stats.episodes_available).toBe(9);
    expect(stats.facts_applied).toBe(3);
  });

  it('leaves an unrecorded counter undefined rather than defaulting it to zero', () => {
    const stats = parseCycleStats(JSON.stringify({ episodes_in: 0 }));
    expect(stats.episodes_in).toBe(0);
    expect(stats.facts_applied).toBeUndefined();
    expect(stats.consumed_through).toBeUndefined();
  });

  it('tolerates unknown keys — the contract is explicitly versionless', () => {
    const stats = parseCycleStats(JSON.stringify({ facts_applied: 1, some_future_counter: 42 }));
    expect(stats.facts_applied).toBe(1);
  });

  it('degrades to an empty object for the empty string, a non-object, or malformed JSON', () => {
    expect(parseCycleStats('')).toEqual({});
    expect(parseCycleStats('{}')).toEqual({});
    expect(parseCycleStats('null')).toEqual({});
    expect(parseCycleStats('[1,2]')).toEqual({});
    expect(parseCycleStats('"a string"')).toEqual({});
    expect(parseCycleStats('{not json')).toEqual({});
  });
});
