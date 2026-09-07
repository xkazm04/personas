import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmedRemoteAction } from '../useConfirmedRemoteAction';

const cfg = { title: 'Undeploy', details: [{ label: 'Name', value: 'Support bot' }] };

describe('useConfirmedRemoteAction', () => {
  it('does not run the action until the user confirms, and names the target', async () => {
    const action = vi.fn(async () => 'done');
    const { result } = renderHook(() => useConfirmedRemoteAction());

    let outcome: Promise<string | undefined>;
    act(() => { outcome = result.current.confirmThen(cfg, action); });
    expect(action).not.toHaveBeenCalled();
    expect(result.current.modal.open).toBe(true);
    expect(result.current.modal.config?.details).toEqual(cfg.details);
    expect(result.current.modal.config?.title).toBe('Undeploy');

    act(() => { result.current.modal.config!.onConfirm(); });
    await expect(outcome!).resolves.toBe('done');
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.modal.open).toBe(false);
  });

  it('resolves undefined on cancel without running the action', async () => {
    const action = vi.fn(async () => 'done');
    const { result } = renderHook(() => useConfirmedRemoteAction());
    let outcome: Promise<string | undefined>;
    act(() => { outcome = result.current.confirmThen(cfg, action); });
    act(() => { result.current.modal.config!.onCancel(); });
    await expect(outcome!).resolves.toBeUndefined();
    expect(action).not.toHaveBeenCalled();
    expect(result.current.modal.open).toBe(false);
  });

  it('propagates the action failure to the caller so its own error door still fires', async () => {
    const action = vi.fn(async () => { throw new Error('orchestrator said no'); });
    const { result } = renderHook(() => useConfirmedRemoteAction());
    let outcome: Promise<unknown>;
    act(() => { outcome = result.current.confirmThen(cfg, action); });
    act(() => { result.current.modal.config!.onConfirm(); });
    await expect(outcome!).rejects.toThrow('orchestrator said no');
  });
});
