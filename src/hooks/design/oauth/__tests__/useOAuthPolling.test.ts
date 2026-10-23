import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock('@/api/system/system', () => ({ openExternalUrl: (url: string) => openExternalUrl(url) }));
vi.mock('@/hooks/utility/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/silentCatch')>()), silentCatch: () => () => {} }));

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

  it('a start call that settles after reset opens no consent page', async () => {
    let finishStart: (value: { authUrl: string; sessionId: string }) => void = () => {};
    const pollFn = vi.fn(async () => ({ status: 'pending' as const }));
    openExternalUrl.mockClear();
    const { result } = renderHook(() => useOAuthPolling({
      startFn: () => new Promise<{ authUrl: string; sessionId: string }>((resolve) => { finishStart = resolve; }),
      pollFn,
      extractValues: (_poll, previous) => previous,
      label: 'Google',
    }));

    act(() => result.current.startConsent());
    act(() => result.current.reset());
    await act(async () => finishStart({ authUrl: 'https://example.com/authorize', sessionId: 'late-session' }));

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(pollFn).not.toHaveBeenCalled();
    expect(result.current.isAuthorizing).toBe(false);
    expect(result.current.message).toBeNull();
  });
});
