/**
 * Unit tests for `countOrphans` — the exported pure predicate behind the Fleet
 * Settings badge.
 *
 * The whole point of the `interactive` clause is that it must NOT count the
 * app's own transient `claude -p` companion/build calls: those are untracked by
 * design, and counting them makes the badge cry orphan every time the app talks
 * to a model. That intent lived only in a doc comment until this file.
 */
import { describe, it, expect } from 'vitest';

import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';
import { countOrphans } from '../useFleetOrphanScan';

const proc = (interactive: boolean, tracked: boolean, pid: number): FleetDetectedProcess =>
  ({ pid, interactive, tracked, cwd: `/repo/${pid}` }) as unknown as FleetDetectedProcess;

describe('countOrphans', () => {
  it('counts only interactive processes Fleet does not track', () => {
    expect(
      countOrphans([
        proc(true, false, 1), // orphan
        proc(true, false, 2), // orphan
        proc(true, true, 3), // tracked — Fleet owns it
        proc(false, false, 4), // transient `claude -p` — untracked BY DESIGN
        proc(false, true, 5),
      ]),
    ).toBe(2);
  });

  it('never counts a non-interactive untracked process', () => {
    // The false-alarm case the interactive clause exists to prevent: a burst of
    // companion calls must not read as a fleet full of abandoned terminals.
    expect(countOrphans([proc(false, false, 1), proc(false, false, 2)])).toBe(0);
  });

  it('returns 0 for an empty scan', () => {
    expect(countOrphans([])).toBe(0);
  });
});
