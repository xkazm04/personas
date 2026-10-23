import { describe, it, expect } from 'vitest';

import { autoRunOutcome } from '../AutoRunBanner';

describe('autoRunOutcome', () => {
  it('a running row the scheduler no longer holds is interrupted, not a finished run', () => {
    // A hard kill leaves dev_auto_runs.status = 'running'; the live map is gone.
    expect(autoRunOutcome({ status: 'running', live: false })).toBe('interrupted');
  });

  it('a live running row is running', () => {
    expect(autoRunOutcome({ status: 'running', live: true })).toBe('running');
  });

  it('keeps the three terminal states the backend writes', () => {
    expect(autoRunOutcome({ status: 'completed', live: false })).toBe('completed');
    expect(autoRunOutcome({ status: 'cancelled', live: false })).toBe('cancelled');
    expect(autoRunOutcome({ status: 'failed', live: false })).toBe('failed');
  });

  it('never reads an unknown or missing status as a success', () => {
    expect(autoRunOutcome({ status: 'paused', live: false })).toBe('interrupted');
    expect(autoRunOutcome({ status: null, live: false })).toBe('interrupted');
  });
});
