import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AMBER_FLOOR_PCT,
  DEFAULT_BUDGET_MS,
  DEFAULT_COVERAGE_GREEN_PCT,
  DEFAULT_DOCS_CLEAN_PCT,
  DEFAULT_DONE_RATE_PCT,
  STEP_KINDS,
} from '../healthRules';

// GATE OVER THE ARTIFACT: `healthRules.ts` restates the judging constants the
// backend owns in src-tauri/src/lifecycle/health.rs (budgets, thresholds) and
// detect_commands.rs (which kinds a step measures), because the UI draws
// against them and the contract does not carry them. This test reads the Rust
// source at run time instead of trusting the copy (precedent:
// serverConfigParity.test.ts), so a changed budget or threshold turns it red.
const LIFECYCLE_RS = resolve(__dirname, '../../../../../../../../src-tauri/src/lifecycle');
const read = (file: string) => readFileSync(resolve(LIFECYCLE_RS, file), 'utf8');

const KIND: Record<string, string> = {
  Lint: 'lint', Typecheck: 'typecheck', Test: 'test', Check: 'check', Coverage: 'coverage', Other: 'other',
};

/** `default_budget_ms`'s match arms: each `Kind | Kind => 60_000,` line. */
function rustBudgets(): Record<string, number> {
  const body = /fn default_budget_ms[\s\S]*?\{([\s\S]*?)\n\}/.exec(read('health.rs'))?.[1] ?? '';
  const out: Record<string, number> = {};
  for (const arm of body.matchAll(/([A-Za-z:|\s]+)=>\s*([\d_]+)/g)) {
    const ms = Number(arm[2]!.replace(/_/g, ''));
    for (const k of arm[1]!.matchAll(/LifecycleGateKind::(\w+)/g)) out[KIND[k[1]!]!] = ms;
  }
  return out;
}

function rustConst(name: string): number {
  const m = new RegExp(`pub const ${name}: \\w+ = ([\\d_.]+);`).exec(read('health.rs'));
  return Number(m?.[1]?.replace(/_/g, '') ?? NaN);
}

/** `kinds_of`'s arms: `"gate" => &[LifecycleGateKind::Lint, ...]`. */
function rustKinds(): Record<string, string[]> {
  const body = /fn kinds_of[\s\S]*?\{([\s\S]*?)\n\}/.exec(read('detect_commands.rs'))?.[1] ?? '';
  const out: Record<string, string[]> = {};
  for (const arm of body.matchAll(/"(\w+)"\s*=>\s*&\[([\s\S]*?)\]/g)) {
    out[arm[1]!] = [...arm[2]!.matchAll(/LifecycleGateKind::(\w+)/g)].map((k) => KIND[k[1]!]!);
  }
  return out;
}

describe('lifecycle health rules: TS restatement <-> Rust parity', () => {
  it('finds the Rust rules it claims to gate', () => {
    // A parse that matched nothing must fail, not report clean.
    expect(Object.keys(rustBudgets())).toHaveLength(6);
    expect(Object.keys(rustKinds()).sort()).toEqual(['gate', 'tests']);
  });

  it('uses the same default budget for every command kind', () => {
    expect(rustBudgets()).toEqual({ ...DEFAULT_BUDGET_MS });
  });

  it('offers each step exactly the kinds Rust measures under it', () => {
    expect(rustKinds()).toEqual({ gate: [...STEP_KINDS.gate!], tests: [...STEP_KINDS.tests!] });
  });

  it('draws the same thresholds Rust judges by', () => {
    expect(rustConst('DEFAULT_COVERAGE_GREEN_PCT')).toBe(DEFAULT_COVERAGE_GREEN_PCT);
    expect(rustConst('DEFAULT_DOCS_CLEAN_PCT')).toBe(DEFAULT_DOCS_CLEAN_PCT);
    expect(rustConst('DEFAULT_DONE_RATE_PCT')).toBe(DEFAULT_DONE_RATE_PCT);
    expect(rustConst('AMBER_FLOOR_PCT')).toBe(AMBER_FLOOR_PCT);
  });
});
