import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// invokeWithTimeout rejects with a serialized AppError OBJECT, never an Error.
// The hook's `instanceof Error ? .message : String(x)` ladder turned that into
// "[object Object]", which is what the Mission Control status banner printed.

const ipcError = { error: 'database is locked', kind: 'Database' };

vi.mock('@/api/overview/sla', () => ({ getSlaDashboard: () => Promise.reject(ipcError) }));
vi.mock('@/api/overview/health', () => ({ getHealthBundle: () => Promise.reject(ipcError) }));
const storeState = { executionDashboard: null, fetchExecutionDashboard: () => Promise.resolve() };
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock('@/lib/storeBus', () => ({ storeBus: { tryGet: () => [] }, AccessorKey: { AGENTS_PERSONAS: 'p' } }));

import { useStatusPageData } from './useStatusPageData';

describe('useStatusPageData per-source errors', () => {
  it('carries the AppError message, not "[object Object]"', async () => {
    const { result } = renderHook(() => useStatusPageData());
    await waitFor(() => expect(result.current.slaError).not.toBeNull());
    await waitFor(() => expect(result.current.healingError).not.toBeNull());
    expect(result.current.slaError).toBe('database is locked');
    expect(result.current.healingError).toBe('database is locked');
    expect(result.current.error).not.toMatch(/object Object/);
  });
});
