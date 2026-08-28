import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { measureStoreAction } from '../storePerf';

describe('measureStoreAction', () => {
  beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('records one measure per call and returns the value', async () => {
    await expect(measureStoreAction('fetchDashboard', async () => 42)).resolves.toBe(42);
    expect(performance.getEntriesByName('store:fetchDashboard', 'measure')).toHaveLength(1);
  });

  it('does not double-prefix an already-prefixed name', async () => {
    await measureStoreAction('store:already', async () => 1);
    expect(performance.getEntriesByName('store:already', 'measure')).toHaveLength(1);
    expect(performance.getEntriesByName('store:store:already', 'measure')).toHaveLength(0);
  });

  // Regression guard. Two marks per call were created and never cleared, on
  // polling paths, in a session that runs for days: an unbounded Performance
  // Timeline buffer. `src/` contained zero clearMarks/clearMeasures calls.
  it('leaves no marks behind, however many times it runs', async () => {
    for (let i = 0; i < 25; i += 1) {
      await measureStoreAction('loop', async () => i);
    }
    expect(performance.getEntriesByName('store:loop:start', 'mark')).toHaveLength(0);
    expect(performance.getEntriesByName('store:loop:end', 'mark')).toHaveLength(0);
    expect(performance.getEntriesByType('mark')).toHaveLength(0);
  });

  it('re-throws the caller error and still records the measure', async () => {
    await expect(
      measureStoreAction('boom', async () => {
        throw new Error('real failure');
      }),
    ).rejects.toThrow('real failure');
    expect(performance.getEntriesByName('store:boom', 'measure')).toHaveLength(1);
    expect(performance.getEntriesByType('mark')).toHaveLength(0);
  });

  // Regression guard for the dangerous one: `performance.measure` sat unguarded
  // in `finally`, so when IT threw the exception replaced the error coming out
  // of `fn()` and the caller saw a perf failure instead of the real one.
  it('never lets a failing measurement replace the caller error', async () => {
    vi.spyOn(performance, 'measure').mockImplementation(() => {
      throw new Error('perf buffer gone');
    });

    await expect(
      measureStoreAction('masked', async () => {
        throw new Error('real failure');
      }),
    ).rejects.toThrow('real failure');
  });

  it('never lets a failing measurement break a successful call', async () => {
    vi.spyOn(performance, 'measure').mockImplementation(() => {
      throw new Error('perf buffer gone');
    });

    await expect(measureStoreAction('ok', async () => 'value')).resolves.toBe('value');
    // Marks are still cleaned up even when the measurement itself failed.
    expect(performance.getEntriesByType('mark')).toHaveLength(0);
  });
});
