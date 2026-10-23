/**
 * A breaker event subscription that fails must not surface as an unhandled
 * rejection. The indicator lives in the persistent title-bar tray, and its two
 * hand-rolled `listen(...).then(...)` subscriptions had no `.catch`, so a
 * rejected `listen` escaped on every mount. `useTauriEvent` routes it to
 * silentCatch. Vitest fails a run on an unhandled rejection, so this test is
 * red on the old code by that alone.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

const t = new Proxy(
  {},
  { get: (_o, section) => new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }) },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));

const listen = vi.fn(() => Promise.reject(new Error('event plugin unavailable')));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...(a as [])) }));

const silent = vi.fn();
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => silent }));

vi.mock('@/api/agents/executions', () => ({
  getCircuitBreakerStatus: vi.fn(async () => ({ globalPaused: false, providers: [], recentTransitions: [] })),
}));

import { CircuitBreakerIndicator } from '../CircuitBreakerIndicator';

describe('CircuitBreakerIndicator event subscriptions', () => {
  it('routes a rejected listen() to silentCatch instead of leaking it', async () => {
    render(<CircuitBreakerIndicator />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(listen).toHaveBeenCalledTimes(2);
    expect(silent).toHaveBeenCalledTimes(2);
  });
});
