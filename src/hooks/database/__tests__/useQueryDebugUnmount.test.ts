import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
const cancelQueryDebug = vi.fn(async (_id: string) => {});
vi.mock('@/api/vault/database/dbSchema', () => ({
  startQueryDebug: vi.fn(async () => {}),
  cancelQueryDebug: (id: string) => cancelQueryDebug(id),
}));

import { useQueryDebug } from '../useQueryDebug';

describe('useQueryDebug unmount', () => {
  it('cancels a live debug job when the hook unmounts, and only a live one', async () => {
    cancelQueryDebug.mockClear();
    const idle = renderHook(() => useQueryDebug());
    idle.unmount();
    expect(cancelQueryDebug).not.toHaveBeenCalled();

    const { result, unmount } = renderHook(() => useQueryDebug());
    await act(async () => result.current.start('credential-1', 'select 1', null, 'postgres'));
    expect(result.current.isRunning).toBe(true);
    unmount();
    expect(cancelQueryDebug).toHaveBeenCalledTimes(1);
    expect(cancelQueryDebug.mock.calls[0]![0]).toMatch(/[0-9a-f-]{36}/);
  });
});
