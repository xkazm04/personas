import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import { useUnsavedGuard } from '../useUnsavedGuard';

// The guard offers Save / Discard / Stay when a dirty editor navigates away.
// On Save it awaited `onSave()` inside a try/catch whose handler cleared the
// pending navigation and closed the modal with an EMPTY catch — so a failed
// write (offline, validation, vault lock) left the user on a still-dirty
// editor with no message, which is exactly what pressing Stay looks like.
describe('useUnsavedGuard — a failed save is not a silent close', () => {
  beforeEach(() => {
    useSystemStore.setState({ sidebarSection: 'personas' });
  });

  /**
   * Mount the guard with a controllable dirty flag. `onSave` may call
   * `rerender({ isDirty: false })` to model the write clearing the flag, which
   * is what the persona editor and the BYOM settings both do.
   */
  const renderGuard = (save: () => Promise<void>) => {
    const onSave = vi.fn(save);
    const h = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedGuard(isDirty, { onSave, onDiscard: vi.fn() }),
      { initialProps: { isDirty: true } },
    );
    return { ...h, onSave };
  };

  /** Open the guard by navigating while dirty. */
  const openGuard = async (result: { current: ReturnType<typeof useUnsavedGuard> }) => {
    await act(async () => {
      useSystemStore.getState().setSidebarSection('settings');
    });
    expect(result.current.isOpen).toBe(true);
  };

  it('keeps the modal open and reports the reason when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network request failed'));
    const { result } = renderHook(() => useUnsavedGuard(true, { onSave, onDiscard: vi.fn() }));
    await openGuard(result);

    await act(async () => { await result.current.resolve('save'); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(true);
    expect(result.current.saveError).toBe('Network request failed');
    expect(result.current.isSaving).toBe(false);
    // The navigation did NOT happen — the user is still where their work is.
    expect(useSystemStore.getState().sidebarSection).toBe('personas');
  });

  it('reports a thrown validation error the same way', async () => {
    const onSave = vi.fn().mockRejectedValue({ error: 'Name is required' });
    const { result } = renderHook(() => useUnsavedGuard(true, { onSave, onDiscard: vi.fn() }));
    await openGuard(result);

    await act(async () => { await result.current.resolve('save'); });

    expect(result.current.saveError).toBe('Name is required');
    expect(result.current.isOpen).toBe(true);
  });

  it('Stay is still reachable after a failed save, and clears the error', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Vault is locked'));
    const { result } = renderHook(() => useUnsavedGuard(true, { onSave, onDiscard: vi.fn() }));
    await openGuard(result);
    await act(async () => { await result.current.resolve('save'); });
    expect(result.current.saveError).toBe('Vault is locked');

    await act(async () => { await result.current.resolve('stay'); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it('a successful save clears the modal and reports no error', async () => {
    const { result, rerender, onSave } = renderGuard(async () => rerender({ isDirty: false }));
    await openGuard(result);

    await act(async () => { await result.current.resolve('save'); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBeNull();
  });

  it('a retry after a failure runs onSave again and clears the error', async () => {
    let attempt = 0;
    const { result, rerender, onSave } = renderGuard(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Network request failed');
      rerender({ isDirty: false });
    });
    await openGuard(result);

    await act(async () => { await result.current.resolve('save'); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.saveError).toBe('Network request failed');

    // The pending navigation survived the failure, so Save is a real retry
    // rather than a dialog the user has to re-trigger by navigating again.
    await act(async () => { await result.current.resolve('save'); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBeNull();
  });
});
