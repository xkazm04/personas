import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * A FOLLOW-ON HANDOFF RIDES THE POST, NOT THE KEYSTROKE.
 *
 * The composer used to summon Athena ("the user wrote ...") the moment a
 * `@athena` line was enqueued. The outbox may hold the directive behind others
 * or fail it, and Athena then replied into the channel to a line that was not
 * there. `enqueue` now takes an `onPosted` hook that runs only after the post
 * landed.
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
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => () => {},
  silentCatch: () => () => {},
}));

let directiveImpl: () => Promise<void> = () => Promise.resolve();
const directiveCalls = vi.fn();
const storeState: Record<string, unknown> = {
  channels: {},
  subscribeChannel: () => () => {},
  loadOlderChannel: vi.fn(),
  sendChannelDirective: (...a: unknown[]) => { directiveCalls(...a); return directiveImpl(); },
  markChannelSeen: vi.fn(),
  refreshChannel: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

async function mountHook() {
  const { useConversation } = await import('../useConversation');
  return renderHook(() => useConversation('team-a'));
}

beforeEach(() => directiveCalls.mockReset());

describe('useConversation enqueue onPosted', () => {
  it('runs the hook only after the directive posted', async () => {
    let post!: () => void;
    directiveImpl = () => new Promise<void>((r) => { post = r; });
    const onPosted = vi.fn();
    const hook = await mountHook();
    act(() => {
      hook.result.current.enqueue('@athena look at this', false, onPosted);
    });
    await waitFor(() => expect(directiveCalls).toHaveBeenCalledTimes(1));
    expect(onPosted).not.toHaveBeenCalled();

    await act(async () => { post(); });
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1));
  });

  it('never runs the hook when the post fails', async () => {
    directiveImpl = () => Promise.reject(new Error('outbox down'));
    const onPosted = vi.fn();
    const hook = await mountHook();
    await act(async () => {
      hook.result.current.enqueue('@athena look at this', false, onPosted);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(directiveCalls).toHaveBeenCalledTimes(1);
    expect(onPosted).not.toHaveBeenCalled();
  });
});
