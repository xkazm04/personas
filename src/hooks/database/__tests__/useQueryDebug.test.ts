import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/api/vault/database/dbSchema', () => ({
  startQueryDebug: vi.fn(async () => { throw { error: 'AI query debug could not start' }; }),
  cancelQueryDebug: vi.fn(async () => {}),
}));
vi.mock('@/lib/silentCatch', () => ({
  extractMessage: (error: unknown) => error && typeof error === 'object' && 'error' in error ? String(error.error) : String(error),
  silentCatch: () => () => {},
}));

import { useQueryDebug } from '../useQueryDebug';

describe('useQueryDebug', () => {
  it('settles the stream and displays the start error when the backend rejects', async () => {
    const { result } = renderHook(() => useQueryDebug());
    await act(async () => result.current.start('credential-1', 'select 1', null, 'postgres'));

    expect(result.current.phase).toBe('failed');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.lines).toContain('AI query debug could not start');
  });
});
