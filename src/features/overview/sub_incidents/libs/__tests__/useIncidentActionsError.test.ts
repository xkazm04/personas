import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToastStore } from '@/stores/toastStore';

// IPC rejects with a serialized AppError OBJECT, never an Error.
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn(() => Promise.reject({ error: 'incident not found', kind: 'NotFound' })),
}));

import { useIncidentActions } from '../useIncidentActions';

describe('useIncidentActions failure toast', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] } as never);
  });

  it('reports a failed acknowledge without "[object Object]"', async () => {
    const onAfterChange = vi.fn();
    const { result } = renderHook(() => useIncidentActions({ onAfterChange }));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.acknowledge('inc-1'); });
    expect(ok).toBe(false);
    expect(onAfterChange).not.toHaveBeenCalled();
    const messages = useToastStore.getState().toasts.map((x: { message: string }) => x.message);
    expect(messages.length).toBe(1);
    expect(messages[0]).not.toContain('[object Object]');
  });
});
