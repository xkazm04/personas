/**
 * The grid overlay's landing view.
 *
 * A small fleet reads best as tiles; past a dozen sessions the tiles are
 * smaller than a useful terminal and the monitor ledger is the better first
 * screen. That default only applies until the operator picks a view from the
 * switcher — from then on their pick wins, for the rest of the app run.
 *
 * The explicit-pick flag is module-scoped, so these cases run in order.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fleetSetGridOpen: vi.fn(), setBackInterceptor: vi.fn() }),
}));
vi.mock('../FleetOverlayTile', () => ({
  FleetOverlayTile: ({ session }: { session: FleetSession }) => <div data-testid={`tile-${session.id}`} />,
}));
vi.mock('../sub_monitor/MonitorView', () => ({
  MonitorView: () => <div data-testid="monitor-view" />,
}));
vi.mock('../fleetTerminalManager', () => ({ setFleetFontOverride: vi.fn() }));

import { FleetTerminalOverlay } from '../FleetTerminalOverlay';

function sessions(n: number): FleetSession[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, state: 'running', projectLabel: 'repo-a', name: null,
  } as unknown as FleetSession));
}

function overlay(open: boolean, n: number) {
  return (
    <FleetTerminalOverlay
      open={open}
      sessions={sessions(n)}
      activeSessionId={null}
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
    />
  );
}

describe('grid overlay landing view', () => {
  it('lands on tiles for a small fleet', () => {
    const { unmount } = render(overlay(true, 5));
    expect(screen.getByTestId('fleet-overlay-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-view')).toBeNull();
    unmount();
  });

  it('lands on the monitor past a dozen live sessions', () => {
    const { unmount } = render(overlay(true, 13));
    expect(screen.getByTestId('monitor-view')).toBeInTheDocument();
    unmount();
  });

  it('honours an explicit pick on the next open, whatever the fleet size', async () => {
    const { rerender, unmount } = render(overlay(true, 13));
    expect(screen.getByTestId('monitor-view')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Terminal tiles'));
    expect(screen.getByTestId('fleet-overlay-grid')).toBeInTheDocument();

    // Close and reopen with a fleet that would otherwise default to monitor.
    rerender(overlay(false, 13));
    rerender(overlay(true, 13));
    expect(screen.getByTestId('fleet-overlay-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-view')).toBeNull();
    unmount();
  });
});
