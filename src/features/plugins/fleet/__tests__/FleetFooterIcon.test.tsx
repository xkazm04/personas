/**
 * Unit tests for the footer fleet cluster.
 *
 * The value here is the three-way click contract — grid open → close, live
 * sessions → raise the overlay *without* navigating, nothing live → navigate
 * to the Fleet page — plus the "needs you" escalation. All of it is store
 * state in / store action out, so the store is mocked at the module boundary
 * and `useTranslation` stays real (labels resolve from the English bundle).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const actions = {
  fleetSetGridOpen: vi.fn(),
  setSidebarSection: vi.fn(),
  setPluginTab: vi.fn(),
  setDevToolsTab: vi.fn(),
};

const state = {
  fleetSessions: [] as FleetSession[],
  fleetGridOpen: false,
  ...actions,
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import FleetFooterIcon from '../FleetFooterIcon';
import { peekGridViewOnOpen } from '../fleetGridView';

let nextId = 0;
const session = (s: FleetSessionState): FleetSession =>
  ({ id: `s${++nextId}`, state: s, projectLabel: 'repo-a', name: null } as unknown as FleetSession);

function mount(sessions: FleetSession[], gridOpen = false) {
  state.fleetSessions = sessions;
  state.fleetGridOpen = gridOpen;
  return render(<FleetFooterIcon />);
}

describe('FleetFooterIcon — click contract', () => {
  beforeEach(() => {
    for (const fn of Object.values(actions)) fn.mockReset();
  });

  it('navigates to the Fleet page when nothing is dispatched', async () => {
    mount([]);
    await userEvent.click(screen.getByTestId('footer-fleet-toggle'));
    expect(actions.setSidebarSection).toHaveBeenCalledWith('plugins');
    expect(actions.setPluginTab).toHaveBeenCalledWith('dev-tools');
    expect(actions.setDevToolsTab).toHaveBeenCalledWith('fleet');
    expect(actions.fleetSetGridOpen).not.toHaveBeenCalled();
  });

  it('raises the grid overlay ON THE MONITOR LEDGER when sessions are dispatched', async () => {
    mount([session('running')]);
    await userEvent.click(screen.getByTestId('footer-fleet-toggle'));
    expect(actions.fleetSetGridOpen).toHaveBeenCalledWith(true);
    expect(actions.setSidebarSection).not.toHaveBeenCalled();
    // The click one-shot-requests the ledger view for the open it triggered —
    // the footer's counts land on the surface that itemizes them.
    expect(peekGridViewOnOpen(1)).toBe('monitor');
  });

  it('closes the grid when it is already open', async () => {
    mount([session('running')], true);
    await userEvent.click(screen.getByTestId('footer-fleet-toggle'));
    expect(actions.fleetSetGridOpen).toHaveBeenCalledWith(false);
    expect(actions.setSidebarSection).not.toHaveBeenCalled();
  });

  it('raises the grid even when only tombstones remain — they hold their tiles', async () => {
    // Exited/hibernated sessions keep in-place tombstone tiles now (dismiss /
    // wake), so the grid is worth opening as long as ANYTHING is tracked.
    mount([session('exited'), session('hibernated')]);
    await userEvent.click(screen.getByTestId('footer-fleet-toggle'));
    expect(actions.fleetSetGridOpen).toHaveBeenCalledWith(true);
    expect(actions.setSidebarSection).not.toHaveBeenCalled();
  });
});

describe('FleetFooterIcon — state counts', () => {
  it('renders one count chip per active state, attention-first', () => {
    mount([session('idle'), session('running'), session('running'), session('awaiting_input')]);
    const chips = screen.getByTestId('footer-fleet-counts');
    expect(chips.textContent).toBe('121');
    expect(screen.getByTestId('footer-fleet-chip-awaiting_input')).toHaveTextContent('1');
    expect(screen.getByTestId('footer-fleet-chip-running')).toHaveTextContent('2');
    expect(screen.getByTestId('footer-fleet-chip-idle')).toHaveTextContent('1');
  });

  it('omits exited sessions from the chips (history, not a live state)', () => {
    mount([session('idle'), session('exited'), session('exited')]);
    expect(screen.getByTestId('footer-fleet-chip-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('footer-fleet-chip-exited')).not.toBeInTheDocument();
  });

  it('gives EVERY non-zero live state its own chip — no lossy +N folding', () => {
    mount([
      session('awaiting_input'), session('running'), session('spawning'),
      session('idle'), session('stale'), session('hibernated'),
    ]);
    for (const state of ['awaiting_input', 'running', 'spawning', 'idle', 'stale', 'hibernated'] as const) {
      expect(screen.getByTestId(`footer-fleet-chip-${state}`)).toHaveTextContent('1');
    }
    expect(screen.queryByTestId('footer-fleet-chip-overflow')).not.toBeInTheDocument();
  });

  it('shows no chip cluster at all when the fleet is empty', () => {
    mount([]);
    expect(screen.queryByTestId('footer-fleet-counts')).not.toBeInTheDocument();
  });
});

describe('FleetFooterIcon — needs-you escalation', () => {
  it('turns violet and announces the blocked count when a session awaits input', () => {
    mount([session('awaiting_input'), session('awaiting_input'), session('idle')]);
    const button = screen.getByTestId('footer-fleet-toggle');
    expect(button.className).toContain('text-violet-300');
    expect(button).toHaveAccessibleName('2 sessions need you');
  });

  it('stays neutral while nothing is blocked', () => {
    mount([session('running')]);
    const button = screen.getByTestId('footer-fleet-toggle');
    expect(button.className).not.toContain('violet');
  });
});

describe('FleetFooterIcon — hover breakdown', () => {
  it('tallies every state (exited included) and offers the page escape hatch', async () => {
    mount([session('running'), session('exited')]);
    await userEvent.hover(screen.getByTestId('footer-fleet-toggle'));
    const popover = screen.getByTestId('footer-fleet-popover');
    expect(popover).toHaveTextContent('2 sessions');
    expect(screen.getByTestId('footer-fleet-row-exited')).toHaveTextContent('1');
    // Grouped under the ledger's lanes: running → Working, exited → Done.
    expect(screen.getByTestId('footer-fleet-lane-working')).toHaveTextContent('1');
    expect(screen.getByTestId('footer-fleet-lane-done')).toHaveTextContent('1');

    await userEvent.click(screen.getByTestId('footer-fleet-open-page'));
    expect(actions.setDevToolsTab).toHaveBeenCalledWith('fleet');
  });
});
