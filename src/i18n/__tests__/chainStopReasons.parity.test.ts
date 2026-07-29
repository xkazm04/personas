import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';

// MIRRORED PAIR — this list is kept byte-for-byte in sync with the
// `pub mod stop_reason` string consts in
// `src-tauri/db/src/chain.rs:45-81`. `reason_token` on
// `chain_stop_reasons` is a raw `String` (not a ts-rs enum), so nothing
// typechecks it, and `tokenLabel()` (`src/i18n/tokenMaps.ts`) falls back to
// rendering the RAW snake_case token with only a DEV-gated `console.warn` when
// a token has no `status_tokens.chain_stop` entry. Without this test, a new
// Rust `stop_reason` const ships to production as an untranslated raw token
// (e.g. `healing_capped`) in all 14 locales, with no build signal.
//
// When you add a stop reason to EITHER side, add the SAME token to the other.
const RUST_STOP_REASONS = [
  'depth_limit',
  'handoff_suppressed',
  'cycle_detected',
  'predicate_unmet',
  'outside_window',
  'malformed_config',
  'cas_lost',
  'quarantined',
  'publish_failed',
  'budget_exceeded',
  'breadth_exceeded',
  'healing_abandoned',
  'healing_capped',
];

describe('chain stop_reason <-> status_tokens.chain_stop parity', () => {
  it('has exactly 13 Rust-side stop reasons (src-tauri/db/src/chain.rs:45-81)', () => {
    expect(RUST_STOP_REASONS).toHaveLength(13);
  });

  it('status_tokens.chain_stop covers exactly the Rust stop_reason consts', () => {
    expect(Object.keys(en.status_tokens.chain_stop).sort()).toEqual(
      [...RUST_STOP_REASONS].sort(),
    );
  });
});
