import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/agents/personas', () => ({
  duplicatePersona: vi.fn(),
  exportPersona: vi.fn(),
  listPersonas: vi.fn(),
}));

import { duplicatePersona, listPersonas } from '@/api/agents/personas';
import { useToastStore } from '@/stores/toastStore';
import { usePersonaShareActions } from '../PersonaOverviewShareActions';

const toasts = () =>
  useToastStore.getState().toasts.map((t) => ({
    message: 'message' in t ? t.message : '',
    type: 'type' in t ? t.type : undefined,
  }));

function setup(ids: string[]) {
  const setSelectedIds = vi.fn();
  const { result } = renderHook(() =>
    usePersonaShareActions({ selectedIds: new Set(ids), setSelectedIds }),
  );
  return result;
}

// scan-sweep sweep-20261030-w1: the duplicate landed; the roster re-read that
// follows it is a separate fact and must not be reported as a failed duplicate.
describe('usePersonaShareActions - a refresh that fails after the duplicate landed', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.mocked(duplicatePersona).mockReset();
    vi.mocked(listPersonas).mockReset();
    vi.mocked(listPersonas).mockRejectedValue(new Error('database is locked'));
    vi.mocked(duplicatePersona).mockResolvedValue({
      name: 'Alpha (copy)',
      triggersCopied: 0,
      subscriptionsCopied: 0,
    } as never);
  });

  it('reports one successful duplicate and no failure', async () => {
    const r = setup([]);
    await act(async () => { await r.current.handleDuplicate('a'); });
    expect(toasts().filter((t) => t.type === 'error')).toEqual([]);
    expect(toasts().filter((t) => t.type === 'success')).toHaveLength(1);
  });

  it('a batch duplicate does not reject when only the refresh fails', async () => {
    const r = setup(['a', 'b']);
    await act(async () => {
      await expect(r.current.handleBatchDuplicate()).resolves.toBeUndefined();
    });
    expect(duplicatePersona).toHaveBeenCalledTimes(2);
    expect(toasts().filter((t) => t.type === 'error')).toEqual([]);
  });
});
