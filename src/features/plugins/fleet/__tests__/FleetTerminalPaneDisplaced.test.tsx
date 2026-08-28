/**
 * Two mount points, one holder.
 *
 * `attachTerminal` re-parents the session's single holder `<div>` into whichever
 * container asked last. The DOM move is inherent — one node cannot paint in two
 * places — but the SILENCE was not: the pane that lost the holder kept
 * rendering an empty black box that never updated again, indistinguishable from
 * a session that has simply printed nothing yet. Five call sites mount a pane
 * for a session id they choose, and two of them (the mastermind preview, the
 * passport modal) live outside the fleet overlay entirely, so nothing
 * structural keeps them from overlapping.
 *
 * `detachTerminal`'s owner token already stops the mutual-teardown half of this.
 * These tests pin the other half: the displaced pane says where its terminal
 * went, and can take it back.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        fleet: {
          terminal_session_gone: 'gone',
          terminal_output_stalled: 'stalled',
          terminal_displaced: 'MOVED-TO-ANOTHER-PANE',
          terminal_displaced_reclaim: 'SHOW-HERE',
        },
      },
    },
    tx: (s: string) => s,
  }),
}));

const attachTerminal = vi.hoisted(() => vi.fn());
const detachTerminal = vi.hoisted(() => vi.fn());
const holderLost = vi.hoisted(() => ({ byContainer: new Map<HTMLElement, () => void>() }));

vi.mock('../fleetTerminalManager', () => ({
  attachTerminal,
  detachTerminal,
  focusTerminal: vi.fn(),
  setFleetTerminalDeadNotice: vi.fn(),
  setFleetTerminalListenerNotice: vi.fn(),
  setTerminalLiveness: vi.fn(),
  onTerminalHolderLost: (container: HTMLElement, cb: () => void) => {
    holderLost.byContainer.set(container, cb);
    return () => holderLost.byContainer.delete(container);
  },
}));

import { FleetTerminalPane } from '../FleetTerminalPane';

describe('FleetTerminalPane displacement notice', () => {
  it('says where the terminal went instead of leaving a silent black box', () => {
    render(<FleetTerminalPane sessionId="s1" />);
    expect(screen.queryByText('MOVED-TO-ANOTHER-PANE')).toBeNull();

    // Another surface attaches the same session; the manager notifies us.
    const container = screen.getByTestId('fleet-terminal-s1');
    act(() => holderLost.byContainer.get(container)!());

    expect(screen.getByText('MOVED-TO-ANOTHER-PANE')).toBeInTheDocument();
    expect(container.getAttribute('data-displaced')).toBe('true');
  });

  it('offers the terminal back, and re-attaching clears the notice', () => {
    render(<FleetTerminalPane sessionId="s2" />);
    const container = screen.getByTestId('fleet-terminal-s2');
    act(() => holderLost.byContainer.get(container)!());
    attachTerminal.mockClear();

    act(() => {
      screen.getByTestId('fleet-terminal-reclaim-s2').click();
    });

    expect(attachTerminal).toHaveBeenCalledWith('s2', container);
    expect(screen.queryByText('MOVED-TO-ANOTHER-PANE')).toBeNull();
    expect(container.getAttribute('data-displaced')).toBe('false');
  });

  it('deregisters the listener on unmount so a dead pane is never called', () => {
    const { unmount } = render(<FleetTerminalPane sessionId="s3" />);
    const container = screen.getByTestId('fleet-terminal-s3');
    expect(holderLost.byContainer.has(container)).toBe(true);

    unmount();

    expect(holderLost.byContainer.has(container)).toBe(false);
  });
});
