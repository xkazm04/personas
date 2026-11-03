/**
 * QUALITY GATES SECTION - the list, the add form and the create door.
 *
 * The section stays mounted across a persona switch (EditorBody does not key
 * the settings tab by persona), so every piece of per-persona state has to be
 * re-derived when `personaId` changes, and every response has to prove it is
 * still the newest before it paints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  listOutputAssertions: vi.fn(),
  createOutputAssertion: vi.fn(),
  deleteOutputAssertion: vi.fn(),
}));
vi.mock('@/api/agents/outputAssertions', () => ({
  listOutputAssertions: (...a: unknown[]) => h.listOutputAssertions(...a),
  createOutputAssertion: (...a: unknown[]) => h.createOutputAssertion(...a),
  deleteOutputAssertion: (...a: unknown[]) => h.deleteOutputAssertion(...a),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => undefined, silentCatch: () => () => undefined }));

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { PersonaAssertionsSection } from '../PersonaAssertionsSection';

const row = (id: string, personaId: string, name: string) => ({
  id, personaId, name, description: null, assertionType: 'contains', config: '{}', severity: 'warning',
  enabled: true, onFailure: 'review', passCount: 0, failCount: 0, lastEvaluatedAt: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.listOutputAssertions.mockReset();
  h.createOutputAssertion.mockReset();
  h.deleteOutputAssertion.mockReset();
});

describe('PersonaAssertionsSection', () => {
  it('drops a stale list response that lands after a persona switch', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    h.listOutputAssertions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(<PersonaAssertionsSection personaId="p1" />);
    rerender(<PersonaAssertionsSection personaId="p2" />);
    await waitFor(() => expect(h.listOutputAssertions).toHaveBeenCalledTimes(2));

    second.resolve([row('a2', 'p2', 'gate of p2')]);
    await waitFor(() => expect(screen.getByText('gate of p2')).toBeInTheDocument());

    first.resolve([row('a1', 'p1', 'gate of p1')]);
    await tick(); await tick();
    expect(screen.queryByText('gate of p1')).toBeNull();
    expect(screen.getByText('gate of p2')).toBeInTheDocument();
  });
});
