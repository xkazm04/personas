// The tether between the screen's "Slowing down" chip and the backend rule
// that files a slow-gate backlog item: the numbers in `SLOWING` are read back
// from the Rust constants, so a change on either side fails here instead of
// the chip and the backlog quietly disagreeing about which command is slow.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SLOWING } from '../signals';

const SLOW_RS = resolve(process.cwd(), 'src-tauri/src/lifecycle/slow.rs');

function rustConst(src: string, name: string): number {
  const m = new RegExp(`pub const ${name}: (?:usize|f64) = ([0-9.]+);`).exec(src);
  if (!m) throw new Error(`${name} not found in slow.rs`);
  return Number(m[1]);
}

describe('SLOWING matches the backend slow-gate rule', () => {
  const src = readFileSync(SLOW_RS, 'utf8');
  it('uses the same recent window, prior floor and factor', () => {
    expect(SLOWING.recentRuns).toBe(rustConst(src, 'RECENT_RUNS'));
    expect(SLOWING.minPriorRuns).toBe(rustConst(src, 'MIN_PRIOR_RUNS'));
    expect(SLOWING.factor).toBe(rustConst(src, 'REGRESSION_FACTOR'));
  });
});
