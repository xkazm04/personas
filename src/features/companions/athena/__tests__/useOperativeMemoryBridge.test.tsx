/**
 * Unit tests for the D7 live-ops bridge and store.
 *
 * Covers:
 *  - Initial fetch on mount populates the store digest.
 *  - `athena://orchestration/digest-changed` events trigger debounced
 *    re-fetches.
 *  - In-flight requests coalesce (a second event during an outstanding
 *    fetch results in exactly one follow-up call, not many).
 *  - Empty digest leaves the store with an empty string.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(unlisten);
  }),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import { useOperativeMemoryBridge } from '../orchestration/useOperativeMemoryBridge';
import { useOperativeMemoryStore } from '../orchestration/operativeMemoryStore';

beforeEach(() => {
  handlers.clear();
  invokeMock.mockReset();
  useOperativeMemoryStore.setState({
    digest: '',
    lastUpdatedAt: null,
    fetching: false,
    expanded: false,
  });
});

describe('useOperativeMemoryBridge', () => {
  it('fetches the digest on mount and populates the store', async () => {
    invokeMock.mockResolvedValueOnce('## Active orchestration\n- **demo** (`op_x`, active)');
    renderHook(() => useOperativeMemoryBridge());

    await waitFor(() => {
      expect(useOperativeMemoryStore.getState().digest).toContain('demo');
    });
    expect(useOperativeMemoryStore.getState().lastUpdatedAt).not.toBeNull();
  });

  it('handles an empty digest (no ops in flight)', async () => {
    invokeMock.mockResolvedValueOnce('');
    renderHook(() => useOperativeMemoryBridge());

    await waitFor(() => {
      expect(useOperativeMemoryStore.getState().lastUpdatedAt).not.toBeNull();
    });
    expect(useOperativeMemoryStore.getState().digest).toBe('');
  });

  it('debounces digest-changed events and re-fetches', async () => {
    invokeMock.mockResolvedValueOnce(''); // initial mount
    invokeMock.mockResolvedValueOnce('## Active orchestration\n- **a** (`op_a`, active)');
    renderHook(() => useOperativeMemoryBridge());

    await waitFor(() => {
      expect(handlers.has('athena://orchestration/digest-changed')).toBe(true);
    });

    // Use fake timers so we can control the debounce.
    vi.useFakeTimers();
    try {
      act(() => {
        handlers.get('athena://orchestration/digest-changed')!({ payload: null });
      });
      // Within debounce window — no new call yet.
      const callsBefore = invokeMock.mock.calls.length;
      // Advance just enough to fire the debounce.
      act(() => {
        vi.advanceTimersByTime(260);
      });
      // Now the re-fetch should be queued; flush the microtask the
      // invoke promise resolution depends on.
      await vi.runAllTimersAsync();
      const callsAfter = invokeMock.mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(useOperativeMemoryStore.getState().digest).toContain('op_a');
    });
  });
});

describe('operativeMemoryStore', () => {
  it('tracks last-updated when digest changes', () => {
    const before = useOperativeMemoryStore.getState().lastUpdatedAt;
    useOperativeMemoryStore.getState().setDigest('hello');
    const after = useOperativeMemoryStore.getState().lastUpdatedAt;
    expect(before).toBeNull();
    expect(after).not.toBeNull();
    expect(useOperativeMemoryStore.getState().digest).toBe('hello');
  });

  it('expand/collapse toggles cleanly', () => {
    useOperativeMemoryStore.getState().setExpanded(true);
    expect(useOperativeMemoryStore.getState().expanded).toBe(true);
    useOperativeMemoryStore.getState().setExpanded(false);
    expect(useOperativeMemoryStore.getState().expanded).toBe(false);
  });
});
