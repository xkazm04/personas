/**
 * Which rows have no process behind them. Three hand-written
 * `exited || hibernated` copies (the session row's X, its Sleep control, the
 * grid tile's trash and the overlay's kill handler) left out `expired` - a
 * queued dispatch retired without ever running - so the X on an expired row
 * called killSession, the backend answered "no child" and the row could never
 * leave the list. One predicate now decides it for every surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FLEET_STATE_META, canHibernateState, isTombstoneState } from '../fleetStateMeta';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const hibernateSession = vi.fn(async () => {});
const killSession = vi.fn(async () => {});
const removeSession = vi.fn(async () => {});
vi.mock('@/api/fleet/fleet', () => ({
  hibernateSession: (...a: unknown[]) => hibernateSession(...(a as [])),
  killSession: (...a: unknown[]) => killSession(...(a as [])),
  removeSession: (...a: unknown[]) => removeSession(...(a as [])),
  renameSession: vi.fn(async () => {}),
}));

const systemState = { fleetPatchSession: vi.fn(), fleetTransitions: {} as Record<string, unknown> };
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: typeof systemState) => unknown) => (selector ? selector(systemState) : systemState),
    { getState: () => systemState },
  ),
}));

import { FleetSessionCard } from '../FleetSessionCard';

function session(over: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', name: 'worker', project: 'personas', state: 'running',
    stateReason: null, lastActivityMs: 0, lastPtyOutputMs: 0, lastGrewMs: 0,
    ...over,
  } as unknown as FleetSession;
}

function renderCard(s: FleetSession) {
  const onRemovedLocal = vi.fn();
  render(<FleetSessionCard session={s} isActive={false} onActivate={vi.fn()} onRemovedLocal={onRemovedLocal} />);
  return { onRemovedLocal };
}

beforeEach(() => vi.clearAllMocks());

describe('isTombstoneState', () => {
  it('names exactly the three states with no process: exited, hibernated, expired', () => {
    const all = FLEET_STATE_META.map((m) => m.id);
    expect(all).toHaveLength(10);
    expect(all.filter(isTombstoneState).sort()).toEqual(['exited', 'expired', 'hibernated']);
  });

  it('never treats a queued dispatch as dismissable - the queue still owns that id', () => {
    expect(isTombstoneState('queued')).toBe(false);
  });

  it('offers Sleep only where there is a process to free', () => {
    const sleepable = FLEET_STATE_META.map((m) => m.id).filter(canHibernateState);
    for (const s of ['exited', 'hibernated', 'expired', 'queued'] as FleetSessionState[]) {
      expect(sleepable).not.toContain(s);
    }
    expect(sleepable).toContain('running');
  });
});

describe('FleetSessionCard on an expired row', () => {
  it('dismisses the row instead of killing a process that never existed', async () => {
    const { onRemovedLocal } = renderCard(session({ state: 'expired' }));
    fireEvent.click(screen.getByTestId('fleet-session-close-s1'));
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith('s1'));
    expect(killSession).not.toHaveBeenCalled();
    expect(onRemovedLocal).toHaveBeenCalledWith('s1');
  });

  it('does not offer Sleep on an expired row', () => {
    renderCard(session({ state: 'expired' }));
    expect(screen.queryByTestId('fleet-session-hibernate-s1')).toBeNull();
  });

  it('does not offer Sleep on a queued row', () => {
    renderCard(session({ state: 'queued' }));
    expect(screen.queryByTestId('fleet-session-hibernate-s1')).toBeNull();
  });

  it('still kills a live row', async () => {
    renderCard(session({ state: 'running' }));
    fireEvent.click(screen.getByTestId('fleet-session-close-s1'));
    // A live row's kill asks first (a70ab0ac58); the confirm ends it.
    expect(killSession).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kill session' }));
    await waitFor(() => expect(killSession).toHaveBeenCalledWith('s1'));
    expect(removeSession).not.toHaveBeenCalled();
  });
});
