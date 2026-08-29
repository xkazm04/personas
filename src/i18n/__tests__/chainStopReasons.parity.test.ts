import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '@/i18n/locales/en.json';

// GATE OVER THE ARTIFACT — this test parses the `pub mod stop_reason` block in
// `src-tauri/db/src/chain.rs` at run time instead of holding a hand-copy of it.
// `reason_token` on `chain_stop_reasons` is a raw `String` (not a ts-rs enum),
// so nothing typechecks it, and `tokenLabel()` (`src/i18n/tokenMaps.ts`) falls
// back to rendering the RAW snake_case token with only a DEV-gated
// `console.warn` when a token has no `status_tokens.chain_stop` entry. A
// hand-copied mirror here checks two hand-maintained lists against each other
// and stays green while the real Rust vocabulary walks away from both — which
// is what it had done: `lookup_failed` and `cost_ceiling_corrupt` shipped
// without labels.
const CHAIN_RS = resolve(__dirname, '../../../src-tauri/db/src/chain.rs');

function rustStopReasons(): string[] {
  const src = readFileSync(CHAIN_RS, 'utf8');
  const block = src.match(/pub mod stop_reason \{([\s\S]*?)\n\}/);
  if (!block) throw new Error(`No 'pub mod stop_reason' block in ${CHAIN_RS}`);
  return [...block[1].matchAll(/pub const [A-Z0-9_]+: &str = "([a-z0-9_]+)";/g)].map(
    (m) => m[1],
  );
}

describe('chain stop_reason <-> status_tokens.chain_stop parity', () => {
  it('finds the Rust stop_reason consts it claims to gate', () => {
    // failure-not-empty-success: a parse that matched nothing must not report clean.
    expect(rustStopReasons().length).toBeGreaterThanOrEqual(13);
  });

  it('status_tokens.chain_stop covers exactly the Rust stop_reason consts', () => {
    expect(Object.keys(en.status_tokens.chain_stop).sort()).toEqual(
      [...rustStopReasons()].sort(),
    );
  });
});
