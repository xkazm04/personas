import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// invokeWithTimeout rejects with a serialized AppError OBJECT, never an Error.
const api = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn() }));
vi.mock('@/api/companion', () => ({
  companionApproveAction: api.approve,
  companionRejectAction: api.reject,
}));
vi.mock('../applyClientAction', () => ({ applyClientAction: vi.fn() }));

import { useApprovalCard } from '../useApprovalCard';

const approval = { id: 'a1', paramsJson: '{}' } as never;

describe('useApprovalCard IPC error text', () => {
  it('reports the AppError reason, not "[object Object]", when approve rejects', async () => {
    api.approve.mockRejectedValue({ error: 'approval expired', kind: 'validation' });
    const { result } = renderHook(() => useApprovalCard(approval, vi.fn()));
    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.error).toBe('approval expired');
  });

  it('reports the AppError reason when reject rejects', async () => {
    api.reject.mockRejectedValue({ error: 'already resolved', kind: 'conflict' });
    const { result } = renderHook(() => useApprovalCard(approval, vi.fn()));
    await act(async () => {
      await result.current.reject();
    });
    expect(result.current.error).toBe('already resolved');
  });
});
