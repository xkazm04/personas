import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/vault/oauthGatewayApi', () => ({
  startOAuth: vi.fn(() => new Promise(() => {})),
  getOAuthStatus: vi.fn(),
}));
vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock('@/hooks/utility/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/silentCatch')>()), silentCatch: () => () => {} }));
vi.mock('@/features/vault/sub_catalog/components/design/CredentialDesignHelpers', () => ({
  OAUTH_FIELD: { SESSION_REF: 'session_ref', SCOPE: 'scope', COMPLETED_AT: 'completed_at', PROVIDER: 'provider' },
}));

import { useUniversalOAuth } from '../useUniversalOAuth';

describe('useUniversalOAuth', () => {
  it('names the requested provider in the starting message', () => {
    const { result } = renderHook(() => useUniversalOAuth());
    act(() => result.current.startConsent({ providerId: 'github', clientId: 'client' }));
    expect(result.current.message?.message).toBe('Starting Github authorization...');
  });
});
