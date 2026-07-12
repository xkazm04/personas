import { describe, expect, it } from 'vitest';

import { slugifyUseCase } from '../useCaseSlug';

// These cases mirror `use_case_tests::slugify_normalizes_casing_separators_and_punctuation`
// in src-tauri/src/db/repos/dev_tools.rs. If one side changes, the telemetry
// join silently stops matching — so both suites assert the same table.
describe('slugifyUseCase (Rust parity)', () => {
  it.each([
    ['Checkout Conversion', 'checkout-conversion'],
    ['checkout_conversion', 'checkout-conversion'],
    ['  Checkout — Conversion!  ', 'checkout-conversion'],
    ['LLM Overview v2', 'llm-overview-v2'],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugifyUseCase(input)).toBe(expected);
  });

  it('collapses runs of separators into exactly one dash', () => {
    expect(slugifyUseCase('a___b---c   d')).toBe('a-b-c-d');
  });

  it('never emits a leading or trailing dash', () => {
    expect(slugifyUseCase('---abc---')).toBe('abc');
  });

  it('is idempotent on an already-slugged value', () => {
    const slug = slugifyUseCase('Agent Execution');
    expect(slugifyUseCase(slug)).toBe(slug);
  });
});
