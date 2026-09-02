/**
 * Tiles stop flashing on every state flip — and this file MEASURES it.
 *
 * A tile mounts a live pane when the session needs the operator
 * (`needsLiveAttention` — awaiting_input) or when it is the focused tile.
 * An agent crosses that line constantly: every tool call it makes goes
 * running -> awaiting_input -> running. Each crossing unmounted the pane and
 * mounted it again, and a pane mount IS an `attachTerminal` — unsubscribe,
 * dispose the WebGL renderer, park, then re-subscribe, `term.reset()` (lossy by
 * construction), replay the ring, reload WebGL. In a 16-session fleet that was
 * the dominant terminal cost and a visible flash.
 *
 * A pane mount is therefore the unit of measurement here: one mount == one
 * attach == one hydrate. The keep-alive window is a hysteresis in the overlay's
 * render policy, so counting mounts of a stub pane measures exactly the thing
 * the change is about, without dragging xterm into jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fleetSetGridOpen: vi.fn(), setBackInterceptor: vi.fn() }),
}));
vi.mock('../fleetTerminalManager', () => ({ setFleetFontOverride: vi.fn(), MAX_WEBGL: 6 }));

/** Mount counter per session — the stand-in for attachTerminal/hydrate. */
const mounts = vi.hoisted(() => ({ byId: new Map<string, number>() }));

function CountedPane({ id }: { id: string }) {
  useEffect(() => {
    mounts.byId.set(id, (mounts.byId.get(id) ?? 0) + 1);
  }, [id]);
  return <div data-testid={`pane-${id}`} />;
}

vi.mock('../FleetOverlayTile', () => ({
  FleetOverlayTile: ({ session, live }: { session: FleetSession; live: boolean }) =>
    live ? <CountedPane id={session.id} /> : <div data-testid={`status-${session.id}`} />,
}));

import { FleetTerminalOverlay } from '../FleetTerminalOverlay';

const session = (id: string, state: string): FleetSession =>
  ({ id, state, projectLabel: `repo-${id}`, name: null }) as unknown as FleetSession;

function overlay(sessions: FleetSession[], activeSessionId: string | null) {
  return (
    <FleetTerminalOverlay
      open
      sessions={sessions}
      activeSessionId={activeSessionId}
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

/** The overlay mounts tile BODIES 200ms after opening (two-phase open). */
const openBodies = () => act(() => void vi.advanceTimersByTime(250));

beforeEach(() => {
  mounts.byId.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FleetTerminalOverlay — attention keep-alive', () => {
  it('MEASUREMENT: pane mounts across 5 running<->awaiting_input flips', () => {
    const { rerender } = render(overlay([session('a', 'awaiting_input')], null));
    openBodies();
    expect(mounts.byId.get('a')).toBe(1); // the initial attach, unavoidable

    // Five full flips, each well inside the keep-alive window.
    for (let i = 0; i < 5; i += 1) {
      rerender(overlay([session('a', 'running')], null));
      act(() => void vi.advanceTimersByTime(500));
      rerender(overlay([session('a', 'awaiting_input')], null));
      act(() => void vi.advanceTimersByTime(500));
    }

    // MEASURED, by running this exact case against the previous revision of
    // FleetTerminalOverlay.tsx: BEFORE = 6 mounts (the initial attach plus one
    // per flip-back), AFTER = 1. Five flips, five avoided detach/attach cycles.
    expect(mounts.byId.get('a')).toBe(1);
  });

  it('keeps the pane mounted while attention is away, and drops it once the window lapses', () => {
    const { rerender, queryByTestId } = render(
      overlay([session('a', 'awaiting_input')], null),
    );
    openBodies();

    rerender(overlay([session('a', 'running')], null));
    act(() => void vi.advanceTimersByTime(3_000));
    // Still live — this is the whole point of the grace.
    expect(queryByTestId('pane-a')).not.toBeNull();

    act(() => void vi.advanceTimersByTime(3_000));
    rerender(overlay([session('a', 'running')], null));
    // Past the window the session has settled into autonomous work: released.
    expect(queryByTestId('pane-a')).toBeNull();
    expect(queryByTestId('status-a')).not.toBeNull();
  });

  it('re-mounts only when attention returns AFTER the window has lapsed', () => {
    const { rerender } = render(overlay([session('a', 'awaiting_input')], null));
    openBodies();
    expect(mounts.byId.get('a')).toBe(1);

    rerender(overlay([session('a', 'running')], null));
    act(() => void vi.advanceTimersByTime(6_000));
    rerender(overlay([session('a', 'awaiting_input')], null));

    expect(mounts.byId.get('a')).toBe(2);
  });

  it('grants no grace when the tiles that want a pane already fill the renderer budget', () => {
    // MAX_WEBGL is 6: seven tiles awaiting input leave no headroom at all, so a
    // tile that lapses is released immediately rather than held.
    const ids = ['s0', 's1', 's2', 's3', 's4', 's5', 's6'];
    const all = (state: (id: string) => string) => ids.map((id) => session(id, state(id)));
    const { rerender, queryByTestId } = render(
      overlay(all(() => 'awaiting_input'), null),
    );
    openBodies();
    expect(queryByTestId('pane-s0')).not.toBeNull();

    rerender(overlay(all((id) => (id === 's0' ? 'running' : 'awaiting_input')), null));
    // No advance: a hold that was granted would still be live here.
    expect(queryByTestId('pane-s0')).toBeNull();
    // The six that still want a pane are untouched.
    expect(queryByTestId('pane-s6')).not.toBeNull();
  });

  it('the active tile is unaffected — it stays live regardless of state', () => {
    const { rerender, queryByTestId } = render(overlay([session('a', 'running')], 'a'));
    openBodies();
    expect(mounts.byId.get('a')).toBe(1);

    rerender(overlay([session('a', 'awaiting_input')], 'a'));
    rerender(overlay([session('a', 'running')], 'a'));
    act(() => void vi.advanceTimersByTime(10_000));
    rerender(overlay([session('a', 'running')], 'a'));

    expect(queryByTestId('pane-a')).not.toBeNull();
    expect(mounts.byId.get('a')).toBe(1);
  });

  it('clears its pending holds on unmount', () => {
    const clear = vi.spyOn(window, 'clearTimeout');
    const { rerender, unmount } = render(overlay([session('a', 'awaiting_input')], null));
    openBodies();
    rerender(overlay([session('a', 'running')], null));
    clear.mockClear();

    unmount();

    // A hold left running would fire setState into a dead component.
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
