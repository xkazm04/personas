import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { _resetAutoCaptureForTests, useAutoCapture } from '../useAutoCapture';

describe('useAutoCapture — one capture per live login, never a loop', () => {
  beforeEach(() => {
    _resetAutoCaptureForTests();
  });

  it('fires once when a new live login is reported as not stored', () => {
    const capture = vi.fn(() => Promise.resolve());
    renderHook(() => useAutoCapture({ active: true, liveEmail: 'a@example.com', capture }));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('never fires while there is no uncaptured live login', () => {
    const capture = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useAutoCapture({ active, liveEmail: 'a@example.com', capture }),
      { initialProps: { active: false } },
    );
    rerender({ active: false });
    expect(capture).not.toHaveBeenCalled();
  });

  it('never fires twice for the same email — not on re-render, not on remount, not after a failure', async () => {
    let attempts = 0;
    let failures = 0;
    // The real action never rejects (usageStripActions toasts inside); this
    // stand-in fails every time so the guard, not the outcome, is what holds.
    const failing = async () => {
      attempts += 1;
      try {
        await Promise.reject(new Error('token dead'));
      } catch {
        failures += 1;
      }
    };
    const first = renderHook(
      ({ capture }: { capture: () => Promise<void> }) => useAutoCapture({ active: true, liveEmail: 'a@example.com', capture }),
      { initialProps: { capture: failing } },
    );
    // A fresh callback identity (the actions object is rebuilt every render).
    first.rerender({ capture: async () => failing() });
    first.unmount();
    renderHook(() => useAutoCapture({ active: true, liveEmail: 'a@example.com', capture: async () => failing() }));
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(failures).toBe(1);
  });

  it('a different live login gets its own single attempt', () => {
    const capture = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ email }: { email: string | null }) => useAutoCapture({ active: true, liveEmail: email, capture }),
      { initialProps: { email: 'a@example.com' } },
    );
    rerender({ email: 'b@example.com' });
    rerender({ email: 'a@example.com' });
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('a login without an email is tried exactly once too', () => {
    const capture = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ email }: { email: string | null }) => useAutoCapture({ active: true, liveEmail: email, capture }),
      { initialProps: { email: null } },
    );
    rerender({ email: null });
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
