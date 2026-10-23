/**
 * The per-row alternative control only opens credential creation for the
 * alternative connector (ConnectorVerificationPanel.handleSwap); it never
 * rebinds the persona's tool requirement, so the original row stays missing.
 * Its copy must say what it does, not promise a swap.
 */
import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';

describe('alternative connector control copy', () => {
  it('names credential setup, not a swap', () => {
    const c = (en as { agents: { connectors: Record<string, string> } }).agents.connectors;
    expect(c.ct_swap_alt_tooltip).not.toMatch(/swap/i);
    expect(c.st_swap_alt).not.toMatch(/swap/i);
    expect(c.ct_swap_alt_tooltip).toMatch(/set up/i);
  });
});
