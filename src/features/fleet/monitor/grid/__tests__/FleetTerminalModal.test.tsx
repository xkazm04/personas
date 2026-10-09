import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';

const api = vi.hoisted(() => ({
  wakeSession: vi.fn(),
  killSession: vi.fn(),
  removeSession: vi.fn(),
  sessionRecap: vi.fn(),
}));
vi.mock('@/api/fleet/fleet', () => api);
// The live pane is xterm; no row in these tests is live.
vi.mock('@/features/plugins/fleet/FleetTerminalPane', () => ({ FleetTerminalPane: () => null }));

import { FleetTerminalModal } from '../FleetTerminalModal';

// A fixture, not a wire payload: only the fields the modal reads are real, and
// the cast names that - the binding's other fields are never touched.
function sleeper(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', claudeSessionId: 'cc-1', name: 'release notes', title: null, projectLabel: 'pumper', cwd: '/x',
    state: 'awaiting_input', mode: 'interactive', dozing: true,
    stateReason: 'Recovered after an app restart - its live connection was lost',
    lastActivityMs: BigInt(Date.now() - 60_000), createdAtMs: BigInt(Date.now() - 3_600_000), origin: 'operator',
    ...o,
  } as unknown as FleetSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.sessionRecap.mockResolvedValue(null);
  useSystemStore.setState({ fleetSessions: [sleeper()], fleetRefresh: vi.fn().mockResolvedValue(undefined) });
});

describe('FleetTerminalModal - a sleeping session', () => {
  it('keeps Kill disabled until a wake is refused', () => {
    render(<FleetTerminalModal session={sleeper()} onClose={vi.fn()} />);
    expect(screen.getByTestId('fleet-terminal-sleeping')).toBeTruthy();
    expect((screen.getByTestId('fleet-terminal-kill') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a refused wake IN the modal and enables Kill', async () => {
    api.wakeSession.mockRejectedValue(new Error('session not resumable: s1'));
    render(<FleetTerminalModal session={sleeper()} onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('fleet-terminal-wake'));
    });
    await waitFor(() => expect(screen.getByTestId('fleet-terminal-wake-error')).toBeTruthy());
    expect((screen.getByTestId('fleet-terminal-kill') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Kill on a sleeping row removes its tombstone instead of killing a process', async () => {
    api.wakeSession.mockRejectedValue(new Error('session not resumable: s1'));
    api.removeSession.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<FleetTerminalModal session={sleeper()} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('fleet-terminal-wake'));
    });
    await waitFor(() => expect(screen.getByTestId('fleet-terminal-wake-error')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('fleet-terminal-kill'));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.removeSession).toHaveBeenCalledWith('s1');
    expect(api.killSession).not.toHaveBeenCalled();
  });

  it('a successful wake follows the new row', async () => {
    api.wakeSession.mockResolvedValue('s2');
    const refresh = vi.fn(async () => {
      useSystemStore.setState({ fleetSessions: [sleeper(), sleeper({ id: 's2', dozing: false, state: 'queued' })] });
    });
    useSystemStore.setState({ fleetRefresh: refresh });
    render(<FleetTerminalModal session={sleeper()} onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('fleet-terminal-wake'));
    });
    await waitFor(() => expect(screen.getByTestId('fleet-terminal-modal').getAttribute('data-kind')).toBe('none'));
    expect(screen.queryByTestId('fleet-terminal-wake-error')).toBeNull();
  });
});
