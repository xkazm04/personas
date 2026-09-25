/**
 * Athena's switch has to UNMOUNT her overlays, not hide them.
 *
 * This is the test the whole work package exists for: before it, the "plugin"
 * switch hid a sidebar entry and one button while her orb, chat panel and
 * guide layer kept their subscriptions, timers and event handlers open. A gate
 * that renders its children invisibly would pass any assertion about the
 * pixels and none of these.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(unlisten);
  }),
}));

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import { __resetCompanionsStatusForTests } from '../../status/companionsStatusStore';
import AthenaGate from '../AthenaGate';

function answer(athenaEnabled: boolean) {
  return {
    companions: [
      { id: 'athena', enabled: athenaEnabled, eligible: true, onboarded: true, detail: {} },
      { id: 'overseer', enabled: false, eligible: false, onboarded: true, detail: {} },
      { id: 'curator', enabled: false, eligible: true, onboarded: true, detail: {} },
    ],
  };
}

/** Stands in for the orb / chat panel / guide layer: it records that it ran. */
let mounted = 0;
function Overlay() {
  mounted += 1;
  return <div data-testid="athena-overlay">orb</div>;
}

beforeEach(() => {
  handlers.clear();
  invokeMock.mockReset();
  mounted = 0;
  __resetCompanionsStatusForTests();
});

describe('AthenaGate', () => {
  it('mounts her overlays while she is switched on', async () => {
    invokeMock.mockResolvedValue(answer(true));
    render(
      <AthenaGate>
        <Overlay />
      </AthenaGate>,
    );
    await waitFor(() => expect(screen.getByTestId('athena-overlay')).toBeTruthy());
  });

  it('unmounts them when she is switched off, rather than hiding them', async () => {
    invokeMock.mockResolvedValue(answer(false));
    render(
      <AthenaGate>
        <Overlay />
      </AthenaGate>,
    );

    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === 'companions_status')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTestId('athena-overlay')).toBeNull());
    // Not "rendered but invisible": the child never stayed in the tree.
    expect(document.querySelector('[data-testid="athena-overlay"]')).toBeNull();
  });

  it('drops them live when the switch flips, without a remount of the host', async () => {
    invokeMock.mockResolvedValue(answer(true));
    render(
      <AthenaGate>
        <Overlay />
      </AthenaGate>,
    );
    await waitFor(() => expect(screen.getByTestId('athena-overlay')).toBeTruthy());

    act(() => {
      handlers.get('companions://status-changed')?.({ payload: answer(false) });
    });
    await waitFor(() => expect(screen.queryByTestId('athena-overlay')).toBeNull());
  });

  it('mounts optimistically before the first read settles, so a normal launch does not blink', () => {
    // The setting defaults to ON. Assuming OFF while the answer is in flight
    // would make every install flash her overlays into existence a moment
    // after launch, which is worse than the rarer opposite.
    invokeMock.mockReturnValue(new Promise(() => {}));
    render(
      <AthenaGate>
        <Overlay />
      </AthenaGate>,
    );
    expect(screen.getByTestId('athena-overlay')).toBeTruthy();
    expect(mounted).toBe(1);
  });
});
