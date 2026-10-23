import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * A ROUTED GOAL BELONGS TO THE TEAM IT WAS ROUTED FOR.
 *
 * `useConversation` is mounted once by the messenger and its `teamId` changes
 * when the operator picks another project. The composer outbox was dropped on
 * that switch, the proposal list was not: a goal decomposed for team A kept
 * rendering in team B's thread, and Confirm there created and started the
 * assignment on team B, because `confirmProposal` read the OPEN team rather
 * than the proposal's. A decomposition still in flight at the switch landed in
 * B the same way.
 */

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const decompose = vi.fn();
const createAssignment = vi.fn();
const startAssignment = vi.fn();
vi.mock('@/api/pipeline/assignments', () => ({
  decomposeTeamAssignmentGoal: (...a: unknown[]) => decompose(...a),
  createTeamAssignment: (...a: unknown[]) => createAssignment(...a),
  startTeamAssignment: (...a: unknown[]) => startAssignment(...a),
}));
vi.mock('@/api/pipeline/teamDeliberations', () => ({
  listTeamDeliberations: () => Promise.resolve([]),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => () => {},
  silentCatch: () => () => {},
}));

const storeState: Record<string, unknown> = {
  channels: {},
  subscribeChannel: () => () => {},
  loadOlderChannel: vi.fn(),
  sendChannelDirective: vi.fn().mockResolvedValue(undefined),
  markChannelSeen: vi.fn(),
  refreshChannel: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

const STEPS = [{ title: 'Step one', description: 'do it', suggestedPersonaId: null }];
const GOAL = 'Build the onboarding checklist for new tenants';

async function mountHook(teamId: string) {
  const { useConversation } = await import('../useConversation');
  return renderHook(({ id }: { id: string }) => useConversation(id), { initialProps: { id: teamId } });
}

function proposalRows(rows: ReadonlyArray<{ kind: string }>) {
  return rows.filter((r) => r.kind === 'proposal');
}

beforeEach(() => {
  decompose.mockReset();
  createAssignment.mockReset();
  startAssignment.mockReset();
});

describe('useConversation proposals across a project switch', () => {
  it('renders a proposal only in the team it was routed for', async () => {
    decompose.mockResolvedValue(STEPS);
    const hook = await mountHook('team-a');
    act(() => {
      hook.result.current.enqueue(GOAL, true);
    });
    await waitFor(() => expect(proposalRows(hook.result.current.rows)).toHaveLength(1));
    expect(decompose).toHaveBeenCalledWith('team-a', GOAL);

    hook.rerender({ id: 'team-b' });
    expect(proposalRows(hook.result.current.rows)).toHaveLength(0);

    // Not lost either: it is still there when the operator goes back.
    hook.rerender({ id: 'team-a' });
    expect(proposalRows(hook.result.current.rows)).toHaveLength(1);
  });

  it('keeps a decomposition that lands after the switch out of the new team', async () => {
    let resolve!: (s: typeof STEPS) => void;
    decompose.mockReturnValue(new Promise((r) => { resolve = r; }));
    const hook = await mountHook('team-a');
    act(() => {
      hook.result.current.enqueue(GOAL, true);
    });
    await waitFor(() => expect(decompose).toHaveBeenCalledTimes(1));

    hook.rerender({ id: 'team-b' });
    await act(async () => {
      resolve(STEPS);
    });
    expect(proposalRows(hook.result.current.rows)).toHaveLength(0);
  });

  it('confirms on the proposal team, whatever conversation is open', async () => {
    decompose.mockResolvedValue(STEPS);
    createAssignment.mockResolvedValue({ id: 'asg-1' });
    startAssignment.mockResolvedValue(undefined);
    const hook = await mountHook('team-a');
    act(() => {
      hook.result.current.enqueue(GOAL, true);
    });
    await waitFor(() => expect(proposalRows(hook.result.current.rows)).toHaveLength(1));
    const row = hook.result.current.rows.find((r) => r.kind === 'proposal');
    if (!row || row.kind !== 'proposal') throw new Error('no proposal row');

    hook.rerender({ id: 'team-b' });
    await act(async () => {
      await hook.result.current.confirmProposal(row.proposal);
    });
    expect(createAssignment).toHaveBeenCalledTimes(1);
    expect(createAssignment.mock.calls[0]![0]).toMatchObject({ teamId: 'team-a', goal: GOAL });
  });
});

describe('useConversation confirm after a failed start', () => {
  it('starts the assignment it already created instead of creating another', async () => {
    decompose.mockResolvedValue(STEPS);
    createAssignment.mockResolvedValue({ id: 'asg-1' });
    startAssignment.mockRejectedValueOnce({ error: 'engine busy', kind: 'Internal' }).mockResolvedValue(undefined);
    const hook = await mountHook('team-a');
    act(() => {
      hook.result.current.enqueue(GOAL, true);
    });
    await waitFor(() => expect(proposalRows(hook.result.current.rows)).toHaveLength(1));
    const first = hook.result.current.rows.find((r) => r.kind === 'proposal');
    if (!first || first.kind !== 'proposal') throw new Error('no proposal row');
    await act(async () => {
      await hook.result.current.confirmProposal(first.proposal);
    });

    // The failed start puts the card back; the retry is pressed on it.
    const again = hook.result.current.rows.find((r) => r.kind === 'proposal');
    if (!again || again.kind !== 'proposal') throw new Error('proposal not restored');
    expect(again.proposal.status).toBe('pending');
    await act(async () => {
      await hook.result.current.confirmProposal(again.proposal);
    });

    expect(createAssignment).toHaveBeenCalledTimes(1);
    expect(startAssignment).toHaveBeenCalledTimes(2);
    expect(startAssignment).toHaveBeenLastCalledWith('asg-1');
    expect(proposalRows(hook.result.current.rows)).toHaveLength(0);
  });
});
