/**
 * The Smee tab used to refetch the whole relay list on every relayed event:
 * an effect keyed on the cumulative `eventsRelayed` counter called
 * `smeeRelayList()` per tick, i.e. one IPC round trip per webhook in a push
 * burst. The refresh is now throttled to one per window, trailing.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const smeeRelayList = vi.fn();
let relayed = 0;

vi.mock('@/api/system/cloud', () => ({
  smeeRelayList: (...a: unknown[]) => smeeRelayList(...a),
  smeeRelayCreate: vi.fn(),
  smeeRelaySetStatus: vi.fn(),
  smeeRelayDelete: vi.fn(),
}));
vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/hooks/realtime/useSmeeRelayStatus', () => ({
  useSmeeRelayStatus: () => ({ eventsRelayed: relayed }),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ personas: [] }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: unknown) => unknown) => selector({ addToast: vi.fn() }),
}));

import { SmeeRelayTab } from '../SmeeRelayTab';

beforeEach(() => {
  vi.useFakeTimers();
  relayed = 0;
  smeeRelayList.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe('SmeeRelayTab relayed-event refresh', () => {
  it('20 relayed events cause at most the mount fetch plus two throttled refreshes', async () => {
    const { rerender } = render(<SmeeRelayTab />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const afterMount = smeeRelayList.mock.calls.length;

    for (let i = 1; i <= 20; i += 1) {
      relayed = i;
      rerender(<SmeeRelayTab />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(smeeRelayList.mock.calls.length - afterMount).toBeLessThanOrEqual(2);
    // The trailing refresh still lands, so the counters are not left stale.
    expect(smeeRelayList.mock.calls.length - afterMount).toBeGreaterThanOrEqual(1);
  });
});
