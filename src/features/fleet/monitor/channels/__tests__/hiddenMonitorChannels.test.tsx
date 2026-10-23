import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MonitorVisibilityContext } from '../../monitorVisibility';

/**
 * A CLOSED MONITOR HOLDS NO CHANNEL KEYS.
 *
 * The overlay is hidden, not unmounted, on close, and every channel key a
 * surface subscribes is re-read by the shared 15s channel poll for as long as
 * it is held. Conversations held two (the blended thread and the
 * deliberation-only key, which nothing else subscribes) and the Map held one,
 * all for a screen nobody could see; the Map also re-rendered its SVG field on
 * a 30s tick. Both now release while hidden and re-take on show.
 */

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/pipeline/assignments', () => ({
  decomposeTeamAssignmentGoal: vi.fn(),
  createTeamAssignment: vi.fn(),
  startTeamAssignment: vi.fn(),
}));
vi.mock('@/api/pipeline/teamDeliberations', () => ({
  listTeamDeliberations: () => Promise.resolve([]),
}));
vi.mock('@/api/pipeline/teams', () => ({
  listTeamMembers: () => Promise.resolve([]),
  listTeamConnections: () => Promise.resolve([]),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => () => {},
  silentCatch: () => () => {},
}));
const t = new Proxy({}, { get: (_o, section) => new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));

/** Live keys: subscribe adds one, its release removes it. */
const held = new Map<string, number>();
const subscribeChannel = vi.fn((teamId: string, kinds?: string[]) => {
  const key = kinds?.length ? `${teamId}|${kinds.join(',')}` : teamId;
  held.set(key, (held.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (held.get(key) ?? 1) - 1;
    if (n <= 0) held.delete(key);
    else held.set(key, n);
  };
});
const storeState: Record<string, unknown> = {
  channels: {},
  subscribeChannel,
  loadOlderChannel: vi.fn(),
  sendChannelDirective: vi.fn(),
  markChannelSeen: vi.fn(),
  refreshChannel: vi.fn(),
};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

function provider(visible: { current: boolean }) {
  return ({ children }: { children: ReactNode }) => (
    <MonitorVisibilityContext.Provider value={visible.current}>{children}</MonitorVisibilityContext.Provider>
  );
}

beforeEach(() => {
  held.clear();
  subscribeChannel.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Conversations on a hidden Monitor', () => {
  it('releases both channel keys while hidden and re-takes them on show', async () => {
    const { useConversation } = await import('../useConversation');
    const visible = { current: true };
    const hook = renderHook(() => useConversation('team-a'), { wrapper: provider(visible) });
    expect(held.size).toBe(2);

    visible.current = false;
    hook.rerender();
    expect(held.size).toBe(0);

    visible.current = true;
    hook.rerender();
    expect(held.size).toBe(2);
  });

  it('takes no key when it first mounts hidden', async () => {
    const { useConversation } = await import('../useConversation');
    renderHook(() => useConversation('team-a'), { wrapper: provider({ current: false }) });
    expect(subscribeChannel).not.toHaveBeenCalled();
  });
});

describe('Map on a hidden Monitor', () => {
  const teams = [{ teamId: 'team-a', teamName: 'A', teamColor: '#888', members: [], selected: true }];

  it('releases its channel key while hidden', async () => {
    const { ChannelMap } = await import('../map/ChannelMap');
    const visible = { current: true };
    const Wrapper = provider(visible);
    const view = render(<Wrapper><ChannelMap teams={teams} onDrillIn={() => {}} /></Wrapper>);
    expect(held.size).toBe(1);

    visible.current = false;
    view.rerender(<Wrapper><ChannelMap teams={teams} onDrillIn={() => {}} /></Wrapper>);
    expect(held.size).toBe(0);
  });

  it('runs no 30s clock while hidden', async () => {
    vi.useFakeTimers();
    const { ChannelMap } = await import('../map/ChannelMap');
    const Wrapper = provider({ current: false });
    render(<Wrapper><ChannelMap teams={teams} onDrillIn={() => {}} /></Wrapper>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
