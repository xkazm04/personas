// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invoke(...args),
}));

import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

describe('devToolsLiveStore.reconcileShip: a moved CDC drop counter refetches every lossy slice', () => {
  beforeEach(() => {
    invoke.mockReset();
    useDevToolsLiveStore.setState({
      shipRevision: 0,
      lifecycleRevision: 0,
      lastSeenCdcDrops: 3,
      reconciling: false,
    });
  });

  it('bumps the lifecycle revision as well as the ship revision', async () => {
    invoke.mockResolvedValue(4);
    await useDevToolsLiveStore.getState().reconcileShip();
    const s = useDevToolsLiveStore.getState();
    expect(s.lastSeenCdcDrops).toBe(4);
    expect(s.shipRevision).toBe(1);
    expect(s.lifecycleRevision).toBe(1);
  });

  it('an unchanged counter bumps nothing', async () => {
    invoke.mockResolvedValue(3);
    await useDevToolsLiveStore.getState().reconcileShip();
    const s = useDevToolsLiveStore.getState();
    expect(s.shipRevision).toBe(0);
    expect(s.lifecycleRevision).toBe(0);
  });
});
