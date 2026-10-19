import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/system/gitlab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/gitlab')>()),
  gitlabGetPipeline: vi.fn(),
  gitlabListPipelineJobs: vi.fn(),
  gitlabGetJobLog: vi.fn(),
}));

import * as gitlabApi from '@/api/system/gitlab';
import type { GitLabPipeline } from '@/lib/bindings/GitLabPipeline';
// Driven through the real store: importing the slice creator alone hits the
// storeTypes -> systemStore import cycle (see cloudSlice.reconcile.test.ts).
import { useSystemStore } from '@/stores/systemStore';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function harness() {
  useSystemStore.getState().gitlabClearPipelineState();
  useSystemStore.setState({ gitlabPipelineLoading: false });
  return { get: () => useSystemStore.getState() };
}

const pipeline = (id: number, status = 'running'): GitLabPipeline => ({
  id, status, ref: 'main', webUrl: `https://gitlab.example/p/${id}`,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', duration: null,
});

const getPipeline = vi.mocked(gitlabApi.gitlabGetPipeline);
const listJobs = vi.mocked(gitlabApi.gitlabListPipelineJobs);
const getJobLog = vi.mocked(gitlabApi.gitlabGetJobLog);

beforeEach(() => {
  vi.clearAllMocks();
  listJobs.mockResolvedValue([]);
});

/**
 * Every pipeline-view write used to take whatever resolved last. The viewer
 * polls the active pipeline, the operator clicks between pipelines and job
 * rows, so an older answer landing late repainted the wrong pipeline or put
 * job A's log under job B.
 */
describe('gitlabSlice — pipeline view writes are latest-wins', () => {
  it('select A then B: A answering late does not replace B', async () => {
    const a = deferred<GitLabPipeline>();
    getPipeline.mockReturnValueOnce(a.promise).mockResolvedValueOnce(pipeline(2));
    const h = harness();

    const pa = h.get().gitlabSelectPipeline(7, 1);
    await h.get().gitlabSelectPipeline(7, 2);
    a.resolve(pipeline(1));
    await pa;

    expect(h.get().gitlabActivePipeline?.id).toBe(2);
    expect(h.get().gitlabPipelineLoading).toBe(false);
  });

  it('a poll of the old pipeline landing after a switch does not repaint it', async () => {
    const poll = deferred<GitLabPipeline>();
    getPipeline.mockReturnValueOnce(poll.promise).mockResolvedValueOnce(pipeline(2));
    const h = harness();

    const pr = h.get().gitlabRefreshPipeline(7, 1);
    await h.get().gitlabSelectPipeline(7, 2);
    poll.resolve(pipeline(1, 'success'));
    await pr;

    expect(h.get().gitlabActivePipeline?.id).toBe(2);
  });

  it('a poll landing after the viewer cleared its state does not refill it', async () => {
    const poll = deferred<GitLabPipeline>();
    getPipeline.mockReturnValueOnce(poll.promise);
    const h = harness();

    const pr = h.get().gitlabRefreshPipeline(7, 1);
    h.get().gitlabClearPipelineState();
    poll.resolve(pipeline(1));
    await pr;

    expect(h.get().gitlabActivePipeline).toBeNull();
  });

  it('a select dropped by a clear does not leave the viewer loading', async () => {
    const sel = deferred<GitLabPipeline>();
    getPipeline.mockReturnValueOnce(sel.promise);
    const h = harness();

    const ps = h.get().gitlabSelectPipeline(7, 1);
    h.get().gitlabClearPipelineState();
    sel.resolve(pipeline(1));
    await ps;

    expect(h.get().gitlabActivePipeline).toBeNull();
    expect(h.get().gitlabPipelineLoading).toBe(false);
  });

  it('expand job A then job B: A\'s late log does not show under B', async () => {
    const logA = deferred<string>();
    getJobLog.mockReturnValueOnce(logA.promise).mockResolvedValueOnce('log of B');
    const h = harness();

    const pa = h.get().gitlabFetchJobLog(7, 101);
    await h.get().gitlabFetchJobLog(7, 102);
    logA.resolve('log of A');
    await pa;

    expect(h.get().gitlabJobLog).toBe('log of B');
  });
});
