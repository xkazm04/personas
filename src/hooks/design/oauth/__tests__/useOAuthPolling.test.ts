import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock('@/hooks/utility/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

import { useOAuthPolling } from '../useOAuthPolling';

describe('useOAuthPolling', () => {
  it('shows the backend error from a rejected status poll', async () => {
    const { result } = renderHook(() => useOAuthPolling({
      startFn: async () => ({ authUrl: 'https://example.com/authorize', sessionId: 'session-1' }),
      pollFn: async () => { throw { error: 'OAuth session expired', kind: 'auth' }; },
      extractValues: (_poll, previous) => previous,
      label: 'Google',
    }));

    act(() => result.current.startConsent());
    await waitFor(() => expect(result.current.message?.message).toBe('OAuth session expired'));
    expect(result.current.isAuthorizing).toBe(false);
  });
});
