/**
 * Athena's `incident_blocker` reminders retire with the last blocker.
 *
 * The orb no longer consumes them (it decides the incidents themselves), so
 * without this they would sit in her chat after the incidents were settled.
 * The sweep dismisses them only when a counts read ANSWERED with zero blocking
 * incidents — never on a failed read, never while something still blocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProactiveMessage } from '@/api/companion';
import { pendingCounts, rejectionOf } from '@/features/decision-center/__tests__/rosterFixtures';
import { resetPendingCountsSource } from '@/features/decision-center/roster/pendingCountsSource';
import { useSystemStore } from '@/stores/systemStore';

import { useAthenaStore } from '../../athenaStore';
import { sweepIncidentReminders } from '../incidentReminderSweep';

const mockPendingCounts = vi.fn();
const mockList = vi.fn();
const mockDismiss = vi.fn();

vi.mock('@/api/devTools/devTools', async (orig) => ({
  ...(await orig<typeof import('@/api/devTools/devTools')>()),
  pendingCounts: () => mockPendingCounts(),
}));
vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListProactiveMessages: (...a: unknown[]) => mockList(...a),
    companionDismissProactive: (...a: unknown[]) => mockDismiss(...a),
  };
});

function nudge(id: string, triggerKind: string): ProactiveMessage {
  return {
    id,
    triggerKind,
    triggerRef: 'inc-1',
    message: 'm',
    createdAt: '2026-10-01T10:00:00Z',
  } as unknown as ProactiveMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingCountsSource();
  useSystemStore.setState({ pendingCounts: null });
  useAthenaStore.getState().setProactive([]);
  mockPendingCounts.mockResolvedValue(pendingCounts({ blockingIncidents: 0 }));
  mockList.mockResolvedValue([nudge('n-1', 'incident_blocker'), nudge('n-2', 'credential_reauth')]);
  mockDismiss.mockResolvedValue(undefined);
});

describe('sweepIncidentReminders', () => {
  it('dismisses every incident_blocker reminder once nothing blocks', async () => {
    useAthenaStore.getState().setProactive([nudge('n-1', 'incident_blocker'), nudge('n-3', 'incident_blocker')]);

    expect(await sweepIncidentReminders()).toBe(2);

    expect(mockDismiss.mock.calls.map((c) => c[0]).sort()).toEqual(['n-1', 'n-3']);
    // The credential reminder is not an incident reminder.
    expect(mockDismiss).not.toHaveBeenCalledWith('n-2');
    expect(useAthenaStore.getState().proactive).toEqual([]);
  });

  it('leaves them while an incident still blocks', async () => {
    mockPendingCounts.mockResolvedValue(pendingCounts({ blockingIncidents: 1 }));

    expect(await sweepIncidentReminders()).toBe(0);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('leaves them when the counts read failed — a failed read proves nothing', async () => {
    mockPendingCounts.mockRejectedValue(new Error('no db'));
    useSystemStore.setState({ pendingCounts: pendingCounts({ blockingIncidents: 0 }) });

    expect(await sweepIncidentReminders()).toBe(0);
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('rejects with a failed dismissal after attempting every one', async () => {
    useAthenaStore.getState().setProactive([nudge('n-3', 'incident_blocker')]);
    mockDismiss.mockImplementation(async (id: string) => {
      if (id === 'n-1') throw new Error('locked');
    });

    const err = await rejectionOf(sweepIncidentReminders());

    expect((err as Error).message).toBe('locked');
    expect(mockDismiss).toHaveBeenCalledWith('n-3');
  });
});
