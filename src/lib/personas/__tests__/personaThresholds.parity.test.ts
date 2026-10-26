// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HEALTH_FAILING_MIN } from '../personaThresholds';

/**
 * Tether for the one value in personaThresholds.ts that mirrors Rust:
 * `HEALTH_FAILING_MIN` must equal `HEALTH_FAILING_RATIO` in the persona repo,
 * which decides the "failing" health label the client then re-derives for the
 * fleet simulation cards.
 */
function rustConst(name: string): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/db/src/repos/core/personas.rs'), 'utf8');
  // Strip line comments so a commented-out or prose mention cannot satisfy the match.
  const code = raw.replace(/\/\/[^\n]*/g, '');
  const m = code.match(new RegExp(String.raw`const\s+${name}\s*:\s*f64\s*=\s*([0-9.]+)\s*;`));
  if (!m) throw new Error(`${name} not found in personas.rs`);
  return Number(m[1]);
}

describe('personaThresholds parity with Rust', () => {
  it('HEALTH_FAILING_MIN equals HEALTH_FAILING_RATIO', () => {
    expect(HEALTH_FAILING_MIN).toBe(rustConst('HEALTH_FAILING_RATIO'));
  });
});
