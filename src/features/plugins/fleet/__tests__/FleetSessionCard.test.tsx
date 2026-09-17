/**
 * The session row's only process control was the X — kill, or (for a dead row)
 * remove. `hibernateSession` already existed, the Settings auto-hibernate
 * policy already called it and the overlay tile already offered it, so an
 * operator who needed a live slot back had to end work they meant to resume.
 *
 * The two claims here are the ones that make the control safe to add next to a
 * kill button: hibernating calls hibernate and NOT kill, and a row with no
 * process to free does not offer it at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';

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
  return render(
    <FleetSessionCard session={s} isActive={false} onActivate={vi.fn()} onRemovedLocal={vi.fn()} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('FleetSessionCard hibernate', () => {
  it('parks a running session without killing it', async () => {
    renderCard(session());
    fireEvent.click(screen.getByTestId('fleet-session-hibernate-s1'));
    await waitFor(() => expect(hibernateSession).toHaveBeenCalledWith('s1'));
    expect(killSession).not.toHaveBeenCalled();
    expect(removeSession).not.toHaveBeenCalled();
  });

  it.each(['exited', 'hibernated'] as const)(
    'offers no hibernate on a %s row, which has no process to free',
    (state) => {
      renderCard(session({ state } as Partial<FleetSession>));
      expect(screen.queryByTestId('fleet-session-hibernate-s1')).toBeNull();
    },
  );

  it('leaves the X as the kill control on a live row', async () => {
    renderCard(session());
    fireEvent.click(screen.getByTestId('fleet-session-close-s1'));
    await waitFor(() => expect(killSession).toHaveBeenCalledWith('s1'));
    expect(hibernateSession).not.toHaveBeenCalled();
  });

  it('leaves the X as remove-from-list on a hibernated row', async () => {
    renderCard(session({ state: 'hibernated' } as Partial<FleetSession>));
    fireEvent.click(screen.getByTestId('fleet-session-close-s1'));
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith('s1'));
    expect(killSession).not.toHaveBeenCalled();
  });
});
