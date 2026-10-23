/**
 * The grid tile's trash ended a live Claude session on one click. A live tile
 * now asks first; a tombstone dismiss stays one click.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('../FleetTerminalPane', () => ({ FleetTerminalPane: () => null }));
vi.mock('../fleetTerminalManager', () => ({ focusTerminal: vi.fn() }));
vi.mock('../FleetTileStatusBlock', () => ({ FleetTileStatusBlock: () => null }));
vi.mock('../sub_grid/FleetSessionInsights', () => ({ FleetSessionInsights: () => null }));
vi.mock('../FleetTileAthenaBar', () => ({ FleetTileAthenaBar: () => null }));

import { FleetOverlayTile } from '../FleetOverlayTile';

function renderTile(state: string, onKill = vi.fn()) {
  const s = { id: 's1', name: 'worker', projectLabel: 'personas', state, mode: 'interactive' } as unknown as FleetSession;
  render(
    <FleetOverlayTile
      session={s} isActive={false} live={false} showInsights={false}
      onToggleInsight={vi.fn()} onSelect={vi.fn()} onKill={onKill}
      approvals={[]} asking={false} onApprove={vi.fn()} onReject={vi.fn()} onAsk={vi.fn()}
    />,
  );
  return onKill;
}

describe('FleetOverlayTile kill', () => {
  it('asks before killing a live session', async () => {
    const onKill = renderTile('running');
    fireEvent.click(screen.getByTestId('fleet-tile-kill-s1'));
    expect(onKill).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kill session' }));
    expect(onKill).toHaveBeenCalledWith('s1');
  });

  it('dismisses a tombstone in one click', () => {
    const onKill = renderTile('exited');
    fireEvent.click(screen.getByTestId('fleet-tile-kill-s1'));
    expect(onKill).toHaveBeenCalledWith('s1');
  });
});
