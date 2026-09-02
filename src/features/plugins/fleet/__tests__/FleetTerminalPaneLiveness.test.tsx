/**
 * A liveness flip must not remount the terminal.
 *
 * `live` is a runtime-varying prop: `passportFleet.tsx:118` and
 * `FleetPreviewPanel.tsx:50` both compute it as `session?.state !== 'hibernated'`
 * and it changes under a mounted pane. It was listed in the attach effect's
 * dependency array, so every hibernate/resume ran a full detach + re-attach —
 * unsubscribe, dispose the WebGL renderer, park, then re-subscribe and re-hydrate
 * through `term.reset()`, which is lossy by design (scrollback 5000 is larger
 * than the backend ring it replays). The operator opened the pane to read what
 * happened at exactly the moment the state changed, and the state change wiped
 * the evidence. Liveness has its own effect and needs no remount.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        fleet: {
          terminal_session_gone: 'gone',
          terminal_output_stalled: 'stalled',
          terminal_displaced: 'moved',
          terminal_displaced_reclaim: 'show here',
        },
      },
    },
    tx: (s: string) => s,
  }),
}));

const attachTerminal = vi.hoisted(() => vi.fn());
const detachTerminal = vi.hoisted(() => vi.fn());
const setTerminalLiveness = vi.hoisted(() => vi.fn());
const focusTerminal = vi.hoisted(() => vi.fn());

vi.mock('../fleetTerminalManager', () => ({
  attachTerminal,
  detachTerminal,
  focusTerminal,
  setFleetTerminalDeadNotice: vi.fn(),
  setFleetTerminalListenerNotice: vi.fn(),
  setTerminalLiveness,
  onTerminalHolderLost: () => () => {},
}));

import { FleetTerminalPane } from '../FleetTerminalPane';

describe('FleetTerminalPane — liveness flips do not remount', () => {
  it('does not re-attach or detach when `live` flips on a mounted pane', () => {
    const { rerender } = render(<FleetTerminalPane sessionId="s1" live />);
    expect(attachTerminal).toHaveBeenCalledTimes(1);

    attachTerminal.mockClear();
    detachTerminal.mockClear();

    // Hibernated → the tombstone predicate flips.
    rerender(<FleetTerminalPane sessionId="s1" live={false} />);
    // ...and back, the way a resumed session does.
    rerender(<FleetTerminalPane sessionId="s1" live />);

    // Zero additional hydrations: no attach means no subscribe and no reset.
    expect(attachTerminal).not.toHaveBeenCalled();
    expect(detachTerminal).not.toHaveBeenCalled();
  });

  it('still pushes the new liveness to the manager', () => {
    setTerminalLiveness.mockClear();
    const { rerender } = render(<FleetTerminalPane sessionId="s2" live />);
    rerender(<FleetTerminalPane sessionId="s2" live={false} />);

    expect(setTerminalLiveness).toHaveBeenLastCalledWith('s2', false);
    expect(screen.getByTestId('fleet-terminal-s2').getAttribute('data-live')).toBe('false');
  });

  it('still re-attaches when the session id itself changes', () => {
    const { rerender } = render(<FleetTerminalPane sessionId="s3" live />);
    attachTerminal.mockClear();
    detachTerminal.mockClear();

    rerender(<FleetTerminalPane sessionId="s4" live />);

    expect(detachTerminal).toHaveBeenCalledTimes(1);
    expect(attachTerminal).toHaveBeenCalledTimes(1);
  });

  it('focuses on mount only when live, without keying the attach effect on it', () => {
    focusTerminal.mockClear();
    render(<FleetTerminalPane sessionId="s5" live={false} />);
    expect(focusTerminal).not.toHaveBeenCalled();

    focusTerminal.mockClear();
    render(<FleetTerminalPane sessionId="s6" live />);
    expect(focusTerminal).toHaveBeenCalledWith('s6');
  });
});
