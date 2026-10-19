/**
 * One wake door per Sessions page. `fleet_wake_session` reads the sleeping row,
 * then AWAITS admission, and only then removes the row - so two wakes of one
 * conversation in flight at once both pass `resume_target` and admit two
 * `claude --resume` processes on the same transcript. `selectSession` guards
 * against that; the pane's Wake button used to bypass it through a second,
 * unguarded `handleWake` in useFleetGridSessionOps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

let releaseWake: (id: string) => void = () => {};
const wakeSession = vi.fn(
  () => new Promise<string>((resolve) => { releaseWake = resolve; }),
);
vi.mock('@/api/fleet/fleet', () => ({
  spawnSession: vi.fn(), killSession: vi.fn(), removeSession: vi.fn(), writeInput: vi.fn(),
  wakeSession: (...a: unknown[]) => wakeSession(...(a as [])),
}));
vi.mock('@/api/companion', () => ({
  companionApproveAction: vi.fn(), companionRejectAction: vi.fn(), companionSendMessage: vi.fn(),
}));

const sleeping = { id: 'old', state: 'hibernated', dozing: false, createdAtMs: 1 } as unknown as FleetSession;
const systemState = {
  fleetSessions: [sleeping],
  fleetRefresh: vi.fn(),
  fleetActiveSessionId: null as string | null,
  fleetSetActiveSession: vi.fn(),
  activeProjectId: null,
  projects: [],
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: typeof systemState) => unknown) => (selector ? selector(systemState) : systemState),
    { getState: () => systemState },
  ),
}));
const athenaState = { approvals: [], removeApproval: vi.fn() };
vi.mock('@/features/companions/athena/athenaStore', () => ({
  useAthenaStore: (selector: (s: typeof athenaState) => unknown) => selector(athenaState),
}));

import { useFleetOverlayActions } from '../useFleetOverlayActions';

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (rel: string) => stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));

beforeEach(() => vi.clearAllMocks());

describe('wake has one guarded door', () => {
  it('a second activation of a session that is still waking does not resume it again', async () => {
    const { result } = renderHook(() => useFleetOverlayActions());
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.selectSession('old'); });
    act(() => { void result.current.selectSession('old'); });
    expect(wakeSession).toHaveBeenCalledTimes(1);
    await act(async () => { releaseWake('new'); await first; });
    expect(systemState.fleetSetActiveSession).toHaveBeenLastCalledWith('new');
  });

  it("the Sessions pane's Wake button goes through selectSession, not a second wake call", () => {
    const page = read('sub_grid/FleetGridPage.tsx');
    expect(page).toMatch(/onWake=\{handleActivate\}/);
    expect(page).toMatch(/handleActivate = useCallback\(\(id: string\) => void selectSession\(id\)/);
    expect(read('sub_grid/useFleetGridSessionOps.ts')).not.toMatch(/\bwakeSession\b/);
  });
});
