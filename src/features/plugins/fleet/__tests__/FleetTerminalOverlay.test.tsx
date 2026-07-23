/**
 * Regression guard for the grid overlay's ownership of `fleetGridOpen`.
 *
 * The overlay used to set that flag on mount and clear it on unmount. Once the
 * app-wide `FleetGridLayer` started *rendering from* the same flag, that write
 * became a cycle: StrictMode's mount → cleanup → mount effect double-invoke
 * fired `setGridOpen(false)` back into the layer mid-flush and wedged the
 * overlay open — mounted, but no longer closeable from the footer. The flag is
 * an input now; this test fails if a write ever comes back.
 *
 * Tiles are stubbed: they pull in xterm, which has nothing to do with the
 * contract under test.
 */
import { describe, it, expect, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const fleetSetGridOpen = vi.fn();
const setBackInterceptor = vi.fn();

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fleetSetGridOpen, setBackInterceptor }),
}));

vi.mock('../FleetOverlayTile', () => ({
  FleetOverlayTile: ({ session }: { session: FleetSession }) => <div data-testid={`tile-${session.id}`} />,
}));

vi.mock('../fleetTerminalManager', () => ({ setFleetFontOverride: vi.fn() }));

import { FleetTerminalOverlay } from '../FleetTerminalOverlay';

const SESSIONS = [
  { id: 's1', state: 'running', projectLabel: 'repo-a', name: null } as unknown as FleetSession,
];

function mount(onClose = vi.fn()) {
  render(
    <StrictMode>
      <FleetTerminalOverlay
        open
        sessions={SESSIONS}
        activeSessionId="s1"
        onSelect={vi.fn()}
        onClose={onClose}
        approvals={[]}
        askingSessionIds={new Set()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAskAthena={vi.fn()}
        onOpenSkills={vi.fn()}
        onSpawn={vi.fn()}
        canSpawn
        onKill={vi.fn()}
      />
    </StrictMode>,
  );
  return onClose;
}

describe('FleetTerminalOverlay — grid-open flag ownership', () => {
  it('never writes fleetGridOpen while mounted', () => {
    fleetSetGridOpen.mockClear();
    mount();
    expect(screen.getByTestId('fleet-terminal-overlay')).toBeInTheDocument();
    expect(fleetSetGridOpen).not.toHaveBeenCalled();
  });

  it('never writes fleetGridOpen on unmount either', () => {
    fleetSetGridOpen.mockClear();
    const { unmount } = render(
      <FleetTerminalOverlay
        open
        sessions={SESSIONS}
        activeSessionId="s1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        approvals={[]}
        askingSessionIds={new Set()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onAskAthena={vi.fn()}
        onOpenSkills={vi.fn()}
        onSpawn={vi.fn()}
        canSpawn
        onKill={vi.fn()}
      />,
    );
    unmount();
    expect(fleetSetGridOpen).not.toHaveBeenCalled();
  });

  it('reports dismissal through onClose — the single close path', async () => {
    const onClose = mount();
    await userEvent.click(screen.getByTestId('fleet-overlay-back'));
    expect(onClose).toHaveBeenCalled();
    expect(fleetSetGridOpen).not.toHaveBeenCalled();
  });

  it('dismisses on Escape', async () => {
    const onClose = mount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
