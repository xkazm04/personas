import { describe, it, expect } from 'vitest';
import { healthCellState } from './DeploymentTable';

describe('healthCellState', () => {
  it('reads loading only while the stats fetch is in flight, then settles to no-data', () => {
    expect(healthCellState('cloud', true)).toBe('loading');
    // Before the fix the cell had no settled branch: a failed stats call for
    // this persona left "Loading..." on screen for the life of the view.
    expect(healthCellState('cloud', false)).toBe('no-data');
  });

  it('never claims to be loading for a target that has no per-persona stats', () => {
    expect(healthCellState('gitlab', true)).toBe('not-applicable');
    expect(healthCellState('gitlab', false)).toBe('not-applicable');
  });
});
