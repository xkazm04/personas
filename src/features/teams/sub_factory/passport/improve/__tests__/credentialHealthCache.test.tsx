import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

import { useEnvConnectors } from '../envConnectors';
import { resetCredentialHealthCache } from '../credentialHealthCache';

const neon = { id: 'cred-neon', name: 'Neon', serviceType: 'neon' } as PersonaCredential;
const healthcheck = vi.hoisted(() => vi.fn(async () => ({ success: true })));

vi.mock('@/api/devTools/devTools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/devTools/devTools')>()),
  listEnvConnectors: vi.fn(async () => []),
}));
vi.mock('@/api/vault/credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vault/credentials')>()),
  listCredentials: vi.fn(async () => [neon]),
  healthcheckCredential: healthcheck,
}));

beforeEach(() => { healthcheck.mockClear(); resetCredentialHealthCache(); });

describe('credential healthcheck reuse', () => {
  it('re-opening a connector surface within the TTL serves the recent result instead of a new provider round-trip', async () => {
    const first = renderHook(() => useEnvConnectors('p1', ['neon']));
    await waitFor(() => expect(first.result.current.health['cred-neon']).toBe(true));
    first.unmount();

    const second = renderHook(() => useEnvConnectors('p1', ['neon']));
    await waitFor(() => expect(second.result.current.health['cred-neon']).toBe(true));

    expect(healthcheck).toHaveBeenCalledTimes(1);
  });
});
