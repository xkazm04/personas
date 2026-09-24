import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plan kept with the project (webbuild_plans) and the parallel create
// path: the draft, the sketch lane and the scaffold run at once, and whichever
// lands first must end up in the right place. None of this had a test; the
// live smoke was the only thing that ever exercised it.

const api = vi.hoisted(() => ({
  webbuildGetPlan: vi.fn(),
  webbuildSavePlan: vi.fn(),
  webbuildSketch: vi.fn(),
  webbuildScaffold: vi.fn(),
  webbuildDevStart: vi.fn(),
  webbuildDevStop: vi.fn(async () => undefined),
  webbuildStatus: vi.fn(async () => null),
  webbuildSessionSend: vi.fn(() => new Promise(() => {})),
  webbuildSessionStop: vi.fn(async () => true),
  webbuildListProjects: vi.fn(async () => []),
  webbuildNextReady: vi.fn(async (ids: string[]) => ids),
  webbuildRegisterExisting: vi.fn(),
}));
vi.mock('@/api/webbuild', () => api);

const swallowed = vi.fn();
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: (ctx: string) => (e: unknown) => swallowed(ctx, e),
  toastCatch: () => vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@/features/plugins/companion/companionStore', () => ({
  useCompanionStore: { getState: () => ({ pulseForwardAck: vi.fn(), pulseMessageReaction: vi.fn(), setOrbGuideTarget: vi.fn() }) },
}));

const { useStudioStore } = await import('../studioStore');
const { useStudioHistory } = await import('../studioHistory');
const { answerNote } = await import('../studioSeed');

const SKETCH = {
  summary: 'A bakery that takes pickup orders.',
  pages: [{ title: 'Home', route: '/', regions: [{ title: 'Menu', purpose: 'today' }] }],
  goals: [{ title: 'Daily menu', note: 'prices' }],
  questions: [{ question: 'Pickup only?', options: ['Yes', 'Delivery too'], why: 'business model' }],
};
const PLAN = [
  { id: 'v', title: 'Vision', status: 'done', note: 'shop' },
  { id: 'm', title: 'Menu', status: 'active', note: null },
];
const status = { projectId: 'p1', port: 5000, url: 'http://localhost:5000', healthy: false, uptimeSecs: 0 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockClear();
  swallowed.mockClear();
  api.webbuildDevStart.mockResolvedValue(status);
  api.webbuildSavePlan.mockResolvedValue(undefined);
  useStudioHistory.setState({ byProject: {}, openTabIds: [], activeTabId: null });
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null, draft: null, lastCreateError: null });
});
afterEach(() => {
  useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null, draft: null });
});

describe('the stored plan', () => {
  it('an opened project draws its stored plan and sketch', async () => {
    api.webbuildGetPlan.mockResolvedValue({ projectId: 'p1', phases: PLAN, sketch: SKETCH, updatedAt: '' });
    await useStudioStore.getState().startExisting('p1', 'Hearth');
    await flush();
    const rt = useStudioStore.getState().runtimes.p1!;
    expect(rt.phases.map((p) => p.title)).toEqual(['Vision', 'Menu']);
    expect(rt.sketch?.summary).toBe(SKETCH.summary);
    expect(rt.sketchState).toBe('ready');
  });

  it('never overwrites a plan a turn set before the stored one arrived', async () => {
    const got = deferred<unknown>();
    api.webbuildGetPlan.mockReturnValue(got.promise);
    await useStudioStore.getState().startExisting('p1', 'Hearth');
    const fresh = [{ id: 'x', title: 'Fresh', status: 'active', note: null }];
    useStudioStore.setState((s) => ({ runtimes: { ...s.runtimes, p1: { ...s.runtimes.p1!, phases: fresh as never } } }));
    got.resolve({ projectId: 'p1', phases: PLAN, sketch: null, updatedAt: '' });
    await flush();
    expect(useStudioStore.getState().runtimes.p1!.phases.map((p) => p.title)).toEqual(['Fresh']);
  });

  it('a plan store that fails never stops the project from opening', async () => {
    api.webbuildGetPlan.mockImplementation(() => {
      throw new Error('no such table: webbuild_plans');
    });
    await useStudioStore.getState().startExisting('p1', 'Hearth');
    await flush();
    expect(useStudioStore.getState().runtimes.p1).toBeTruthy();
    expect(api.webbuildDevStart).toHaveBeenCalledWith('p1');
    expect(swallowed).toHaveBeenCalledWith('studioStore:getPlan', expect.any(Error));
  });
});

describe('creating a project', () => {
  it('a sketch that lands during the scaffold rides into the project and is stored with it', async () => {
    api.webbuildGetPlan.mockResolvedValue(null);
    const scaffold = deferred<{ id: string; name: string }>();
    api.webbuildScaffold.mockReturnValue(scaffold.promise);
    api.webbuildSketch.mockResolvedValue(SKETCH);
    const creating = useStudioStore.getState().createWithVision('Hearth', 'A bakery');
    // The screen moves on at once: the draft exists before anything returns.
    expect(useStudioStore.getState().draft?.name).toBe('Hearth');
    await flush();
    expect(useStudioStore.getState().draft?.sketch?.summary).toBe(SKETCH.summary);
    useStudioStore.getState().answerSketch(null, 0, 'Delivery too');
    scaffold.resolve({ id: 'p1', name: 'Hearth' });
    await creating;
    await flush();
    const rt = useStudioStore.getState().runtimes.p1!;
    expect(useStudioStore.getState().draft).toBeNull();
    expect(rt.sketch?.summary).toBe(SKETCH.summary);
    expect(rt.sketchAnswers[0]).toBe('Delivery too');
    expect(rt.setupStartedAt).toBeTypeOf('number');
    expect(api.webbuildSavePlan).toHaveBeenCalledWith('p1', [], SKETCH);
    // The seed turn carries the vision and the answer given during the draft.
    const seed = String(api.webbuildSessionSend.mock.calls[0]?.[1]);
    expect(seed).toContain('A bakery');
    expect(seed).toContain('Delivery too');
  });

  it('a sketch that lands after the scaffold goes to the project and is stored', async () => {
    api.webbuildGetPlan.mockResolvedValue(null);
    const sketch = deferred<typeof SKETCH>();
    api.webbuildSketch.mockReturnValue(sketch.promise);
    api.webbuildScaffold.mockResolvedValue({ id: 'p1', name: 'Hearth' });
    await useStudioStore.getState().createWithVision('Hearth', 'A bakery');
    sketch.resolve(SKETCH);
    await flush();
    expect(useStudioStore.getState().runtimes.p1!.sketch?.summary).toBe(SKETCH.summary);
    expect(api.webbuildSavePlan).toHaveBeenCalledWith('p1', [], SKETCH);
  });

  it('a scaffold that fails keeps its reason in the form and leaves no project', async () => {
    api.webbuildSketch.mockReturnValue(new Promise(() => {}));
    api.webbuildScaffold.mockRejectedValue(new Error('Bun is not installed'));
    await useStudioStore.getState().createWithVision('Hearth', 'A bakery');
    expect(useStudioStore.getState().draft).toBeNull();
    expect(useStudioStore.getState().lastCreateError).toBe('Bun is not installed');
    expect(useStudioStore.getState().runtimes).toEqual({});
  });

  it('an answer given after the project exists reaches her as a note for her next step', async () => {
    api.webbuildGetPlan.mockResolvedValue(null);
    await useStudioStore.getState().startExisting('p1', 'Hearth');
    useStudioStore.setState((s) => ({ runtimes: { ...s.runtimes, p1: { ...s.runtimes.p1!, sketch: SKETCH } } }));
    useStudioStore.getState().answerSketch('p1', 0, 'Yes');
    const rt = useStudioStore.getState().runtimes.p1!;
    expect(rt.sketchAnswers[0]).toBe('Yes');
    expect(rt.queuedNotes).toEqual([answerNote('Pickup only?', 'Yes')]);
  });
});
