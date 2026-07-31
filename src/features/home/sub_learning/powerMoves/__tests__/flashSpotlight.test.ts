import { describe, expect, it, vi } from 'vitest';
import { flashSpotlight } from '../flashSpotlight';

describe('flashSpotlight', () => {
  it('resolves without throwing when the testid contains selector-breaking characters', async () => {
    // A quote/bracket in the id would previously be interpolated directly
    // into `document.querySelector(`[data-testid="${testId}"]`)` and throw a
    // SyntaxError inside this fire-and-forget async function -- an unhandled
    // rejection nobody awaits or catches. The charset guard must reject it
    // gracefully instead.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flashSpotlight('bad"id]')).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  it('resolves without throwing for an empty testid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flashSpotlight('')).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});
