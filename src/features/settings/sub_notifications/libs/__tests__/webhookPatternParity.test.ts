import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patternMatches } from '../webhookMatch';

// GATE OVER THE ARTIFACT: `patternMatches` is a TS mirror of the dispatcher's
// matcher (`pattern_matches` in src-tauri/src/engine/webhook_notifier.rs). The
// picker's preview is only honest while the two agree, so this test parses the
// Rust unit assertions at run time instead of holding a hand-copy of them
// (precedent: src/i18n/__tests__/chainStopReasons.parity.test.ts). A new or
// changed Rust assertion that the TS mirror does not honour turns this red.
const NOTIFIER_RS = resolve(__dirname, '../../../../../../src-tauri/src/engine/webhook_notifier.rs');

interface RustAssertion {
  expected: boolean;
  pattern: string;
  eventType: string;
}

function rustAssertions(): RustAssertion[] {
  const src = readFileSync(NOTIFIER_RS, 'utf8');
  const re = /assert!\((!?)pattern_matches\("([^"]*)",\s*"([^"]*)"\)\)/g;
  return [...src.matchAll(re)].map((m) => ({
    expected: m[1] !== '!',
    pattern: m[2] ?? '',
    eventType: m[3] ?? '',
  }));
}

describe('webhook pattern matcher: TS mirror <-> Rust pattern_matches parity', () => {
  it('finds the Rust assertions it claims to gate', () => {
    // A parse that matched nothing must fail, not report clean.
    const found = rustAssertions();
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found.some((a) => a.expected)).toBe(true);
    expect(found.some((a) => !a.expected)).toBe(true);
  });

  it('every Rust assertion holds for patternMatches', () => {
    const mismatches = rustAssertions().filter(
      (a) => patternMatches(a.pattern, a.eventType) !== a.expected,
    );
    expect(mismatches).toEqual([]);
  });
});
