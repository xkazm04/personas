// @vitest-environment node
/**
 * The sweep judges a shipped finding against EVERY signal still over threshold,
 * not against the top-N slice it is allowed to raise.
 *
 * Four sensors cap what a sweep files (SENTRY_TOP_N, DOC_ROT_TOP_N,
 * SKILL_DORMANT_TOP_N, MEMORY_DISPUTED_TOP_N, all 3). Verification used to read
 * the capped drafts, so a finding whose signal was still present but had been
 * out-ranked into fourth place was absent from them, and absence from a probed
 * sensor is the one state `verdictFor` calls `cleared`. The loop then credited
 * itself a win for a signal that never moved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevProject } from '@/lib/bindings/DevProject';

const setFindingVerifyState = vi.fn();
const getMemoryDisputedOverview = vi.fn();
const createFinding = vi.fn();
const fetchSentryUnresolvedIssues = vi.fn();
const splitSentrySlug = vi.fn();

vi.mock('@/api/devTools/devTools', () => ({
  createFinding: (...a: unknown[]) => createFinding(...a),
  getDocRotOverview: () => Promise.resolve([]),
  getMemoryDisputedOverview: () => getMemoryDisputedOverview(),
  getSkillUsageOverview: () => Promise.resolve([]),
  listFindingDedupKeys: () => Promise.resolve([]),
  listSkills: () => Promise.resolve([]),
  listStandards: () => Promise.resolve([]),
  setFindingVerifyState: (...a: unknown[]) => setFindingVerifyState(...a),
}));
vi.mock('@/api/devTools/useCases', () => ({ listUseCases: () => Promise.resolve([]) }));
vi.mock('@/features/plugins/dev-tools/sub_overview/adapters', () => ({
  fetchSentryUnresolvedIssues: (...a: unknown[]) => fetchSentryUnresolvedIssues(...a),
  splitSentrySlug: (...a: unknown[]) => splitSentrySlug(...a),
}));
vi.mock('@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters', () => ({
  fetchLlmPinpoints: () => Promise.resolve([]),
  hasLiveAdapter: () => false,
}));

import { runFindingSweep } from '../sweep';
import { MEMORY_DISPUTED_TOP_N, SENTRY_TOP_N } from '../findingConfig';

const project = {
  id: 'p1',
  llm_tracking_credential_id: null,
  monitoring_credential_id: 'cred-sentry',
  monitoring_project_slug: 'org/proj',
} as unknown as DevProject;

/** A finding that shipped: accepted, carrying a completed task. */
function shipped(id: string, origin: string, dedupKey: string, evidence: Record<string, unknown>): DevIdea {
  return { id, origin, dedup_key: dedupKey, status: 'accepted', evidence: JSON.stringify(evidence) } as unknown as DevIdea;
}
function doneTask(ideaId: string): DevTask {
  return { id: `t-${ideaId}`, source_idea_id: ideaId, status: 'completed' } as unknown as DevTask;
}

function memory(id: string, openClaims: number) {
  return {
    project_id: 'p1', memory_id: id, memory_title: id, persona_name: 'Ada',
    open_claims: openClaims, latest_verdict: 'wrong', latest_note: null,
  };
}
function issue(shortId: string, count: number) {
  return { id: shortId, shortId, title: shortId, culprit: null, count, lastSeen: null };
}

/** The verdict the sweep persisted for one finding id. */
function verdictOf(id: string): string | undefined {
  return setFindingVerifyState.mock.calls.find((c) => c[0] === id)?.[1] as string | undefined;
}

describe('runFindingSweep - verification reads the uncapped signal set', () => {
  beforeEach(() => {
    setFindingVerifyState.mockReset().mockResolvedValue(undefined);
    createFinding.mockReset().mockResolvedValue({ id: 'new' });
    splitSentrySlug.mockReset().mockReturnValue(['org', 'proj']);
    fetchSentryUnresolvedIssues.mockReset().mockResolvedValue([]);
    getMemoryDisputedOverview.mockReset().mockResolvedValue([]);
  });

  it('a disputed memory out-ranked past the cap is still disputed, not cleared', async () => {
    // MEMORY_DISPUTED_TOP_N louder memories push m-quiet out of the raised slice.
    const louder = Array.from({ length: MEMORY_DISPUTED_TOP_N }, (_, i) => memory(`m-loud-${i}`, 5 + i));
    getMemoryDisputedOverview.mockResolvedValue([...louder, memory('m-quiet', 1)]);
    const quiet = shipped('f-quiet', 'memory_disputed', 'memory:m-quiet', { openClaims: 1 });
    // Control: a memory that really has no open claims left.
    const gone = shipped('f-gone', 'memory_disputed', 'memory:m-gone', { openClaims: 2 });

    const res = await runFindingSweep({
      project, credentials: [], kpiAttention: [],
      ideas: [quiet, gone], tasks: [doneTask('f-quiet'), doneTask('f-gone')],
    });

    expect(verdictOf('f-quiet')).toBe('unchanged');
    expect(verdictOf('f-gone')).toBe('cleared');
    expect(res.verified).toMatchObject({ cleared: 1, unchanged: 1 });
  });

  it('a Sentry issue that is fourth-loudest is still a spike, compared on its count', async () => {
    const loud = Array.from({ length: SENTRY_TOP_N }, (_, i) => issue(`LOUD-${i}`, 900 + i));
    fetchSentryUnresolvedIssues.mockResolvedValue([...loud, issue('QUIET-1', 400)]);
    const f = shipped('f-sentry', 'sentry_spike', 'sentry:QUIET-1', { count: 100 });

    await runFindingSweep({
      project,
      credentials: [{ id: 'cred-sentry', serviceType: 'sentry' }],
      kpiAttention: [],
      ideas: [f],
      tasks: [doneTask('f-sentry')],
    });

    // 100 -> 400 events: the work shipped and the issue got louder.
    expect(verdictOf('f-sentry')).toBe('regressed');
  });

  it('the cap still bounds what a sweep RAISES', async () => {
    getMemoryDisputedOverview.mockResolvedValue(
      Array.from({ length: MEMORY_DISPUTED_TOP_N + 2 }, (_, i) => memory(`m-${i}`, 1 + i)),
    );

    const res = await runFindingSweep({ project, credentials: [], kpiAttention: [] });

    expect(createFinding).toHaveBeenCalledTimes(MEMORY_DISPUTED_TOP_N);
    expect(res.created).toBe(MEMORY_DISPUTED_TOP_N);
  });

  it('names a persistence failure by its IPC message, not "[object Object]"', async () => {
    getMemoryDisputedOverview.mockResolvedValue([memory('m-1', 2)]);
    createFinding.mockRejectedValue({ error: 'database is locked', kind: 'Database' });

    const res = await runFindingSweep({ project, credentials: [], kpiAttention: [] });

    expect(res.errors).toEqual(['persist: database is locked']);
  });
});
