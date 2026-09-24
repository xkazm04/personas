// The wrappers' AFFORDANCES — moved from columns beside the body into the
// node's symbol row, and still buttons with the same accessible names.
//
// What the operator reaches from the keyboard must not change with the
// layout: every verb the old `leading` / `trailing` columns carried (drag
// grip, lock, recap, ↑/↓, the ⋯ menu) is here, plus Cancel and Start now as
// direct buttons, all as SIBLINGS of the body inside the affordance cluster.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { QueueTile } from '../QueueTile';
import { SessionTile } from '../../../SessionTile';
import type { QueueItem } from '../useQueueModel';
import type { QueueActions } from '../useQueueActions';

const NOW = Date.now();

// A fixture, not a wire payload: only the fields the tiles read are real, and
// the cast names that.
function session(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', title: 'Fix flaky login test', name: null, projectLabel: 'pumper', cwd: '/x', state: 'running',
    createdAtMs: BigInt(NOW - 5 * 60_000), origin: 'dev_runner',
    ...o,
  } as unknown as FleetSession;
}

function item(o: Partial<QueueItem> = {}): QueueItem {
  const s = session({ id: 'q1', state: 'queued', origin: 'autopilot', ...(o.session ?? {}) });
  return {
    sessionId: s.id, session: s, rank: 2, origin: 'autopilot', personaId: null, goalId: null,
    projectLabel: s.projectLabel, locked: false, estimatedStartMs: NOW + 20 * 60_000, notBeforeMs: null,
    ...o,
  };
}

const actions: QueueActions = {
  cancel: vi.fn(async () => true), startNow: vi.fn(async () => true), reorder: vi.fn(async () => true),
} as unknown as QueueActions;

const cluster = () => screen.getByTestId('fleet-node-affordances');
const body = () => screen.getByTestId('fleet-queue-tile').firstElementChild!;
const names = () => [...cluster().querySelectorAll('button, [role="button"], [role="img"]')].map((e) => e.getAttribute('aria-label'));

describe('QueueTile — a queued row', () => {
  it('carries grip · ↑ · ↓ · start now · cancel · menu as buttons in the cluster, outside the body', () => {
    render(<QueueTile item={item()} actions={actions} onNudge={() => {}} dragHandle />);
    expect(names()).toEqual([
      'Drag to reorder the queue', 'Move up in the queue', 'Move down in the queue', 'Start now', 'Cancel', 'Queue actions for Fix flaky login test',
    ]);
    for (const b of cluster().querySelectorAll('button')) expect(body().contains(b)).toBe(false);
    expect(screen.getByTestId('fleet-queue-menu').tagName).toBe('BUTTON');
    expect(screen.getByTestId('fleet-queue-up').tagName).toBe('BUTTON');
    expect(screen.getByTestId('fleet-queue-cancel').tagName).toBe('BUTTON');
    expect(screen.getByTestId('fleet-queue-start-now').tagName).toBe('BUTTON');
  });

  it('nudges with the same handler, and disables the arrow at either end', () => {
    const onNudge = vi.fn();
    render(<QueueTile item={item()} actions={actions} onNudge={onNudge} first />);
    expect((screen.getByTestId('fleet-queue-up') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('fleet-queue-down'));
    expect(onNudge).toHaveBeenCalledWith('q1', 1);
  });

  it('has no grip when nothing drives a drag, and no arrows without onNudge', () => {
    render(<QueueTile item={item()} actions={actions} />);
    expect(names()).toEqual(['Start now', 'Cancel', 'Queue actions for Fix flaky login test']);
  });

  it('opens the confirm behind Cancel and Start now, never the verb directly', () => {
    render(<QueueTile item={item()} actions={actions} />);
    fireEvent.click(screen.getByTestId('fleet-queue-cancel'));
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('is an inert body (no PTY to open yet) with the symbol row inside it', () => {
    render(<QueueTile item={item()} actions={actions} onOpen={() => {}} />);
    expect(body().tagName).toBe('SPAN');
    expect(screen.getByTestId('fleet-queue-rank').textContent).toBe('2');
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('autopilot');
  });
});

describe('QueueTile — a running row', () => {
  it('carries the lock and the recap, opens its terminal from the body', () => {
    const onOpen = vi.fn();
    const onRecap = vi.fn();
    const live = item({ locked: true, rank: null, estimatedStartMs: null, session: session({ id: 'r1', state: 'running' }), sessionId: 'r1', origin: 'dev_runner' });
    render(<QueueTile item={live} actions={actions} onOpen={onOpen} onRecap={onRecap} />);
    expect(names()).toEqual(['Running — holds a slot and is not in the queue', 'Session recap']);
    expect(screen.getByTestId('fleet-queue-lock').getAttribute('role')).toBe('img');
    fireEvent.click(screen.getByTestId('fleet-queue-recap'));
    expect(onRecap).toHaveBeenCalledWith(live.session);
    fireEvent.click(screen.getByTestId('fleet-queue-open'));
    expect(onOpen).toHaveBeenCalledWith(live.session);
    expect(screen.queryByTestId('fleet-queue-menu')).toBeNull();
    expect(screen.queryByTestId('fleet-queue-rank')).toBeNull();
  });
});

describe('SessionTile — the classic board', () => {
  it('keeps the recap as a button beside the body, with its published test id and name', () => {
    const onRecap = vi.fn();
    render(<SessionTile session={session()} width={172} height={44} onOpen={() => {}} onRecap={onRecap} />);
    const recap = screen.getByTestId('fleet-grid-session-recap');
    expect(recap.tagName).toBe('BUTTON');
    expect(recap.getAttribute('aria-label')).toBe('Session recap');
    expect(screen.getByTestId('fleet-grid-session').contains(recap)).toBe(false);
    fireEvent.click(recap);
    expect(onRecap).toHaveBeenCalled();
  });

  it('names the origin in the body\'s accessible name and shows it as a symbol', () => {
    render(<SessionTile session={session()} width={172} height={44} />);
    expect(screen.getByTestId('fleet-grid-session').getAttribute('aria-label')).toContain('Dispatched by Dev runner');
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('dev_runner');
    expect(screen.queryByTestId('fleet-node-affordances')).toBeNull();
  });
});
