import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// studioStore carries every behaviour Studio actually has — the autonomous
// chain and its stop conditions, the reply splitter, rehydrate — and none of it
// was covered. The chain is the expensive one: it drives a real CLI against a
// real project, so a miscounted cap or a missed stop condition is not a render
// bug, it is turns spent.

const webbuildSessionSend = vi.fn();
const webbuildListProjects = vi.fn();
const webbuildSessionStop = vi.fn();

vi.mock('@/api/webbuild', () => ({
  webbuildSessionSend: (...a: unknown[]) => webbuildSessionSend(...a),
  webbuildListProjects: () => webbuildListProjects(),
  webbuildStatus: vi.fn(async () => ({ healthy: true, url: 'http://localhost:3000' })),
  webbuildDevStart: vi.fn(async () => ({ healthy: false, url: '' })),
  webbuildDevStop: vi.fn(),
  webbuildNextReady: vi.fn(async (ids: string[]) => ids),
  webbuildRegisterExisting: vi.fn(),
  webbuildScaffold: vi.fn(),
  webbuildSessionStop: (...a: unknown[]) => webbuildSessionStop(...a),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => vi.fn(),
  toastCatch: () => vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

vi.mock('@/features/plugins/companion/companionStore', () => ({
  useCompanionStore: {
    getState: () => ({ pulseForwardAck: vi.fn(), pulseMessageReaction: vi.fn() }),
  },
}));

const { useStudioStore, splitReply, AUTO_MAX_TURNS } = await import('../studioStore');
type ProjectRuntime = import('../studioStore').ProjectRuntime;
const { useStudioHistory } = await import('../studioHistory');
const { MOCK_PHASES } = await import('../studioBuildModel');

const ID = 'p1';

/** Seed a live runtime directly — the boot path is covered by bootPoll.test. */
function seedRuntime(patch: Partial<ProjectRuntime> = {}) {
  useStudioStore.setState({
    runtimes: {
      [ID]: {
        id: ID,
        name: 'Demo',
        phase: 'live',
        status: null,
        phases: MOCK_PHASES,
        busy: false,
        stream: '',
        reply: null,
        messages: [],
        question: null,
        autonomous: false,
        seedPending: null,
        autoTurns: 0,
        resumeAuto: false,
        effort: 'xhigh',
        style: 'balanced',
        options: [],
        decisionArea: null,
        decisionSelector: null,
        gatePlan: false,
        mcp: [],
        stopNoop: false,
        ...patch,
      },
    },
    tabOrder: [ID],
    activeId: ID,
  });
}

const reply = (over: Record<string, unknown> = {}) => ({
  reply: 'Done.',
  question: null,
  options: [],
  area: null,
  selector: null,
  phases: null,
  ...over,
});

describe('splitReply', () => {
  it('splits on blank lines so a narration becomes several beats', () => {
    expect(splitReply('one\n\ntwo\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('keeps a fenced code block whole, blank lines inside it included', () => {
    const parts = splitReply('before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter');
    expect(parts).toHaveLength(3);
    expect(parts[1]).toBe('```ts\nconst a = 1;\n\nconst b = 2;\n```');
  });

  it('does not shred the tail of a fence the model never closed', () => {
    // A truncated turn ends mid-snippet. With the fence still open every
    // remaining blank line must stay swallowed, or the log shows a code block
    // chopped into unrelated bubbles.
    const parts = splitReply('intro\n\n```ts\nconst a = 1;\n\nconst b = 2;');
    expect(parts).toEqual(['intro', '```ts\nconst a = 1;\n\nconst b = 2;']);
  });

  it('returns nothing for an empty reply and one part for one paragraph', () => {
    expect(splitReply('   \n  ')).toEqual([]);
    expect(splitReply('just this')).toEqual(['just this']);
  });
});

describe('the autonomous chain stops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    webbuildSessionSend.mockReset();
    webbuildSessionSend.mockResolvedValue(reply());
    useStudioHistory.setState({ byProject: {}, openTabIds: [], activeTabId: null });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('chains another turn while there is plan left and budget left', async () => {
    seedRuntime({ autonomous: true, autoTurns: 0 });

    await useStudioStore.getState().sendTurn(ID, 'go');
    expect(webbuildSessionSend).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(webbuildSessionSend.mock.calls.length).toBeGreaterThan(1);
    expect(useStudioStore.getState().runtimes[ID]?.autonomous).toBe(true);
  });

  it('stops at the turn cap instead of running forever', async () => {
    seedRuntime({ autonomous: true, autoTurns: AUTO_MAX_TURNS });

    await useStudioStore.getState().sendTurn(ID, 'go');
    await vi.advanceTimersByTimeAsync(5000);

    expect(useStudioStore.getState().runtimes[ID]?.autonomous).toBe(false);
    // One turn ran — the one we asked for. Nothing was chained past the cap.
    expect(webbuildSessionSend).toHaveBeenCalledTimes(1);
  });

  it('stops when every phase in the plan is done', async () => {
    seedRuntime({
      autonomous: true,
      phases: [
        { id: 'a', title: 'A', status: 'done' },
        { id: 'b', title: 'B', status: 'done' },
      ],
    });

    await useStudioStore.getState().sendTurn(ID, 'go');
    await vi.advanceTimersByTimeAsync(5000);

    expect(useStudioStore.getState().runtimes[ID]?.autonomous).toBe(false);
    expect(webbuildSessionSend).toHaveBeenCalledTimes(1);
  });

  it('hands control back to the user on a question, and remembers to resume', async () => {
    seedRuntime({ autonomous: true });
    webbuildSessionSend.mockResolvedValue(
      reply({ question: 'Which palette?', options: ['Warm', 'Cool'] }),
    );

    await useStudioStore.getState().sendTurn(ID, 'go');
    await vi.advanceTimersByTimeAsync(5000);

    const rt = useStudioStore.getState().runtimes[ID];
    expect(rt?.autonomous).toBe(false);
    expect(rt?.resumeAuto).toBe(true);
    expect(rt?.question).toBe('Which palette?');
    // The chain must not have kept running behind the question.
    expect(webbuildSessionSend).toHaveBeenCalledTimes(1);
  });

  it('resumes the chain once an answered turn comes back without a question', async () => {
    seedRuntime({ autonomous: false, resumeAuto: true });

    await useStudioStore.getState().sendTurn(ID, 'Warm');

    expect(useStudioStore.getState().runtimes[ID]?.autonomous).toBe(true);
    expect(useStudioStore.getState().runtimes[ID]?.resumeAuto).toBe(false);
  });

  it('drops out of the chain when a turn fails rather than retrying blind', async () => {
    seedRuntime({ autonomous: true });
    webbuildSessionSend.mockRejectedValue(new Error('CLI timed out'));

    await useStudioStore.getState().sendTurn(ID, 'go');
    await vi.advanceTimersByTimeAsync(5000);

    const rt = useStudioStore.getState().runtimes[ID];
    expect(rt?.autonomous).toBe(false);
    expect(rt?.resumeAuto).toBe(false);
    // The cause stays in the conversation, not only in a toast that vanishes.
    expect(rt?.messages.at(-1)?.text).toContain('CLI timed out');
  });
});

describe('Stop reads whether it actually stopped anything', () => {
  // webbuild_session_stop returns whether a turn was really interrupted. That
  // boolean used to be discarded, so a Stop that found nothing to stop looked
  // exactly like one that worked — and `busy` then cleared only when the pending
  // session_send hit its 26-minute ceiling, with the dock disabled the whole time.
  beforeEach(() => {
    vi.useFakeTimers();
    webbuildSessionSend.mockReset();
    webbuildSessionSend.mockResolvedValue(reply());
    webbuildSessionStop.mockReset();
    webbuildSessionStop.mockResolvedValue(true);
    useStudioHistory.setState({ byProject: {}, openTabIds: [], activeTabId: null });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('releases the dock at once when there was nothing to interrupt', async () => {
    seedRuntime({ busy: true });
    webbuildSessionStop.mockResolvedValue(false);

    useStudioStore.getState().stopTurn(ID);
    await vi.advanceTimersByTimeAsync(0);

    const rt = useStudioStore.getState().runtimes[ID];
    expect(rt?.busy).toBe(false);
    expect(rt?.stopNoop).toBe(true);
  });

  it('leaves the turn alone when the interrupt landed — the send resolves it', async () => {
    seedRuntime({ busy: true });
    webbuildSessionStop.mockResolvedValue(true);

    useStudioStore.getState().stopTurn(ID);
    await vi.advanceTimersByTimeAsync(0);

    const rt = useStudioStore.getState().runtimes[ID];
    expect(rt?.busy).toBe(true);
    expect(rt?.stopNoop).toBe(false);
  });

  it('fences off the abandoned turn so it cannot release the next one', async () => {
    let resolveGhost!: (v: unknown) => void;
    webbuildSessionSend.mockImplementationOnce(
      () => new Promise((r) => { resolveGhost = r; }),
    );
    seedRuntime();

    void useStudioStore.getState().sendTurn(ID, 'go');
    expect(useStudioStore.getState().runtimes[ID]?.busy).toBe(true);

    webbuildSessionStop.mockResolvedValue(false);
    useStudioStore.getState().stopTurn(ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(useStudioStore.getState().runtimes[ID]?.busy).toBe(false);

    // The user starts over. This turn is the live one.
    let resolveLive!: (v: unknown) => void;
    webbuildSessionSend.mockImplementationOnce(
      () => new Promise((r) => { resolveLive = r; }),
    );
    void useStudioStore.getState().sendTurn(ID, 'again');
    expect(useStudioStore.getState().runtimes[ID]?.busy).toBe(true);
    expect(useStudioStore.getState().runtimes[ID]?.stopNoop).toBe(false);

    // The abandoned turn finally comes back. It must not touch the live one.
    resolveGhost(reply());
    await vi.advanceTimersByTimeAsync(0);
    expect(useStudioStore.getState().runtimes[ID]?.busy).toBe(true);

    resolveLive(reply());
    await vi.advanceTimersByTimeAsync(0);
    expect(useStudioStore.getState().runtimes[ID]?.busy).toBe(false);
  });
});

describe('rehydrate', () => {
  beforeEach(() => {
    webbuildListProjects.mockReset();
    useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
  });

  it('does not resurrect a persisted tab whose project is gone', async () => {
    useStudioHistory.setState({
      byProject: {},
      openTabIds: ['deleted'],
      activeTabId: 'deleted',
    });
    webbuildListProjects.mockResolvedValue([{ id: 'other', name: 'Other' }]);

    useStudioStore.getState().rehydrate();
    await vi.waitFor(() => expect(webbuildListProjects).toHaveBeenCalled());

    expect(useStudioStore.getState().tabOrder).toEqual([]);
    expect(useStudioStore.getState().activeId).toBeNull();
  });

  it('leaves live tabs alone — it only ever runs on a blank Studio', async () => {
    seedRuntime();
    useStudioHistory.setState({ byProject: {}, openTabIds: ['x'], activeTabId: 'x' });

    useStudioStore.getState().rehydrate();

    expect(webbuildListProjects).not.toHaveBeenCalled();
    expect(useStudioStore.getState().tabOrder).toEqual([ID]);
  });
});
