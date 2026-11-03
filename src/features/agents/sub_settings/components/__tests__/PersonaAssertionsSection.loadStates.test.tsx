// state-coverage: ZERO rows, FAILED and NOT-YET-RETURNED must not render identically.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  it('says the load failed instead of reporting "no gates", and says nothing while loading', async () => {
    const pending = deferred<unknown[]>();
    h.listOutputAssertions.mockReturnValueOnce(pending.promise);
    render(<PersonaAssertionsSection personaId="p1" />);
    expect(screen.queryByText('assertions.empty'), 'empty shown while loading').toBeNull();
    pending.reject(new Error('ipc down'));
    await tick(); await tick();
    expect(screen.queryByText('assertions.empty'), 'empty shown after a failed load').toBeNull();
    expect(screen.getByText('assertions.load_failed')).toBeInTheDocument();
  });
});
