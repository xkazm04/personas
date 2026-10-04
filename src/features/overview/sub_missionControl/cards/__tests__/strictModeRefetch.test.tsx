import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { AttentionLoopStatus } from '@/lib/bindings/AttentionLoopStatus';

/**
 * Both cards guarded their mount fetch with a `fetchingRef` boolean AND
 * discarded the result when the starting effect was torn down. Under
 * StrictMode's development double mount that combination deadlocks:
 *
 *   mount 1  -> boolean set, fetch starts
 *   cleanup  -> `cancelled = true`, so mount 1's answer will be thrown away
 *   mount 2  -> retry REFUSED, the boolean is still set
 *   answer   -> discarded; the boolean clears, but nothing re-runs
 *
 * The card then sat on its ghost until its own 30s interval fired. These tests
 * drive the real double mount and assert the data lands without any timer
 * advancing — `vi.useFakeTimers()` guarantees the 30s interval cannot rescue it.
 */

const listAllTriggers = vi.fn<() => Promise<PersonaTrigger[]>>();
const getAttentionLoopStatus = vi.fn<() => Promise<AttentionLoopStatus>>();

vi.mock('@/api/pipeline/triggers', () => ({ listAllTriggers: () => listAllTriggers() }));
vi.mock('@/api/agents/personaBrain', () => ({ getAttentionLoopStatus: () => getAttentionLoopStatus() }));
vi.mock('@/api/system/settings', () => ({ setAppSetting: vi.fn().mockResolvedValue(undefined) }));

const trigger: PersonaTrigger = {
  id: 'trig-1',
  persona_id: 'persona-abcdef12',
  trigger_type: 'schedule',
  config: null,
  enabled: true,
  status: 'active',
  last_triggered_at: null,
  next_trigger_at: new Date(Date.now() + 3_600_000).toISOString(),
  trigger_version: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  use_case_id: null,
  responsibility_id: null,
  unattended_mode: 'auto',
};

const loopStatus: AttentionLoopStatus = {
  enabled: true,
  summary: {
    dispatchedToday: 3,
    refusedToday: 1,
    consolidationsToday: 0,
    personasServedToday: 2,
  },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listAllTriggers.mockReset().mockResolvedValue([trigger]);
  getAttentionLoopStatus.mockReset().mockResolvedValue(loopStatus);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Mission Control cards under a StrictMode double mount', () => {
  it('UpcomingRoutinesCard shows its rows without waiting for the 30s interval', async () => {
    const { default: UpcomingRoutinesCard } = await import('../UpcomingRoutinesCard');
    render(
      <StrictMode>
        <UpcomingRoutinesCard />
      </StrictMode>,
    );

    // `personaName` falls back to the first 8 chars of the persona id when the
    // roster is cold, which is the state a fresh dev load is in.
    await waitFor(() => expect(screen.getByText('persona-')).toBeTruthy());
    // The retry was actually ISSUED, not merely allowed: mount 1 and mount 2
    // each fetched. One call would mean mount 2 was refused again.
    expect(listAllTriggers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('AttentionLoopCard shows its readout without waiting for the 30s interval', async () => {
    const { default: AttentionLoopCard } = await import('../AttentionLoopCard');
    render(
      <StrictMode>
        <AttentionLoopCard />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('attention-loop-toggle')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();
    expect(getAttentionLoopStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('still refuses to stack a second fetch on top of one in flight', async () => {
    let release!: (rows: PersonaTrigger[]) => void;
    listAllTriggers.mockReset().mockImplementation(
      () => new Promise<PersonaTrigger[]>((resolve) => { release = resolve; }),
    );

    const { default: UpcomingRoutinesCard } = await import('../UpcomingRoutinesCard');
    render(<UpcomingRoutinesCard />);

    // One mount, one in-flight request. Firing the cadence while it hangs must
    // not start a second — that overlap guard is what the boolean was FOR, and
    // the generation counter has to keep it.
    expect(listAllTriggers).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(listAllTriggers).toHaveBeenCalledTimes(1);

    await act(async () => { release([trigger]); });
    await waitFor(() => expect(screen.getByText('persona-')).toBeTruthy());

    // Once it settles the slot is free again and the next tick does fetch.
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(listAllTriggers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
