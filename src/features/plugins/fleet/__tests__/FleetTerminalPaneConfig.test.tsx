/**
 * Every terminal pane carries the operator's persisted terminal settings.
 *
 * The settings bridge (`useFleetTerminalConfig`) used to be mounted only by the
 * Fleet grid page and the dev-only grid overlay. A pane opened anywhere else
 * first - the monitor's terminal modal, the passport modal, the mastermind
 * preview - ran on the manager's built-in defaults, so an operator who had
 * turned copy-on-select off still had every selection written to the
 * clipboard, and a light app showed a dark terminal at the default font.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';

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

const configureFleetTerminals = vi.hoisted(() => vi.fn());

vi.mock('../fleetTerminalManager', () => ({
  attachTerminal: vi.fn(),
  detachTerminal: vi.fn(),
  focusTerminal: vi.fn(),
  setFleetTerminalDeadNotice: vi.fn(),
  setFleetTerminalListenerNotice: vi.fn(),
  setTerminalLiveness: vi.fn(),
  configureFleetTerminals,
  appIsLightTheme: () => true,
  onTerminalHolderLost: () => () => {},
}));

import { useSystemStore } from '@/stores/systemStore';
import { FleetTerminalPane } from '../FleetTerminalPane';

describe('FleetTerminalPane - persisted terminal settings', () => {
  beforeEach(() => {
    configureFleetTerminals.mockClear();
  });

  it('pushes the persisted font, copy-on-select and resolved theme on mount', () => {
    useSystemStore.setState({
      fleetTerminalFontSize: 16,
      fleetTerminalCopyOnSelect: false,
      fleetTerminalTheme: 'auto',
    });

    render(<FleetTerminalPane sessionId="cfg-1" />);

    expect(configureFleetTerminals).toHaveBeenCalledWith({
      fontSize: 16,
      copyOnSelect: false,
      // `auto` resolves against the app's own theme (light here).
      theme: 'light',
    });
  });

  it('follows a settings change while the pane is mounted', () => {
    useSystemStore.setState({ fleetTerminalCopyOnSelect: true, fleetTerminalTheme: 'dark' });
    render(<FleetTerminalPane sessionId="cfg-2" />);
    configureFleetTerminals.mockClear();

    act(() => {
      useSystemStore.setState({ fleetTerminalCopyOnSelect: false });
    });

    expect(configureFleetTerminals).toHaveBeenCalledWith(
      expect.objectContaining({ copyOnSelect: false, theme: 'dark' }),
    );
  });
});
