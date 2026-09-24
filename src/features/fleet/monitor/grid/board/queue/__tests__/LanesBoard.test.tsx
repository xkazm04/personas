// LanesBoard — every node spans its lane.
//
// The lane IS the column, so a fixed 172 px node left most of it empty and
// truncated the title for nothing. Running, Queued and Parked nodes all fill;
// the affordances and the elapsed bar stay anchored to the node's own edges.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { LanesBoard } from '../LanesBoard';
import type { QueueItem, QueueModel } from '../useQueueModel';
import type { QueueActions } from '../useQueueActions';
import type { LocalOrder } from '../useLocalOrder';
import { NodeContext } from '../../node/nodeContext';

const NOW = Date.now();

// A fixture, not a wire payload: only the fields the lanes and tiles read are
// real, and the cast names that.
function session(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', title: 'Fix flaky login test', name: null, projectLabel: 'pumper', cwd: '/x', state: 'running',
    createdAtMs: BigInt(NOW - 5 * 60_000), lastActivityMs: BigInt(NOW - 60_000), origin: 'dev_runner',
    ...o,
  } as unknown as FleetSession;
}

function item(s: FleetSession, o: Partial<QueueItem> = {}): QueueItem {
  return {
    sessionId: s.id, session: s, rank: null, origin: 'dev_runner', personaId: null, goalId: null,
    projectLabel: s.projectLabel, locked: true, estimatedStartMs: null, notBeforeMs: null,
    ...o,
  };
}

const actions = {
  cancel: vi.fn(async () => true), startNow: vi.fn(async () => true), reorder: vi.fn(async () => true),
} as unknown as QueueActions;

function renderLanes() {
  const live = session({ id: 'run' });
  const waiting = session({ id: 'wait', state: 'queued', origin: 'autopilot' });
  const done = session({ id: 'done', state: 'finished' });
  const queued = [item(waiting, { rank: 1, locked: false, origin: 'autopilot', teamId: 't1' })];
  const model: QueueModel = { running: [item(live)], queued, cap: 3, overAdmitted: 0, empty: false };
  const order: LocalOrder = {
    items: queued, moveTo: vi.fn(), place: vi.fn(), nudge: vi.fn(), setOrder: vi.fn(), commit: vi.fn(),
  };
  // A queue length in context, so the queued node draws its elapsed bar.
  render(
    <NodeContext.Provider value={{ meanDurationMs: 10 * 60_000, queueLength: 3 }}>
      <LanesBoard
        model={model}
        order={order}
        actions={actions}
        sessions={[live, waiting, done]}
        // Only `id` and `color` are read (the lane's accent map); the cast names that.
        teams={[{ id: 't1', color: '#ff0000' } as never]}
        reducedMotion
        focusKey={null}
        onOpenSession={vi.fn()}
        onRecapSession={vi.fn()}
      />
    </NodeContext.Provider>,
  );
}

describe('LanesBoard — nodes fill their lane', () => {
  it('gives every node in every lane no fixed pixel width', () => {
    renderLanes();
    for (const lane of ['fleet-queue-lane-running', 'fleet-queue-lane-queued', 'fleet-queue-lane-parked']) {
      const tiles = within(screen.getByTestId(lane)).getAllByTestId('fleet-queue-tile');
      expect(tiles.length).toBeGreaterThan(0);
      for (const tile of tiles) {
        expect(tile.style.width).toBe('');
        expect(tile).toHaveAttribute('data-width', 'fill');
        expect(tile.className).toContain('w-full');
      }
    }
  });

  it('lets a queued node take the rest of the row beside its team accent bar', () => {
    renderLanes();
    const tile = within(screen.getByTestId('fleet-queue-lane-queued')).getByTestId('fleet-queue-tile');
    expect(tile.className).toContain('flex-1');
    expect(tile.className).toContain('min-w-0');
    expect(tile.className).not.toContain('flex-shrink-0');
    // The accent bar is its sibling in the same row.
    expect(tile.parentElement!.firstElementChild!.getAttribute('style')).toContain('background-color');
  });

  it('keeps the affordances and the elapsed bar anchored inside the node', () => {
    renderLanes();
    const tile = within(screen.getByTestId('fleet-queue-lane-queued')).getByTestId('fleet-queue-tile');
    const cluster = within(tile).getByTestId('fleet-node-affordances');
    expect(cluster.className).toContain('absolute');
    expect(cluster.className).toContain('right-1');
    expect(within(tile).getByTestId('fleet-node-elapsed').className).toContain('absolute');
  });
});
