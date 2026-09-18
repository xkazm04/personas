import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PlanItem } from '@/features/teams/sub_factory/passport/improve/improvePlan';

/**
 * Sweep #46 — `passport_gap` and `kpi_offtrack` were declared sensors that no
 * entry point could ever fire, because `SweepInputs.plan` / `.kpiAttention` were
 * optional and neither SweepButton nor `runHealthIngest` supplied them.
 *
 * Three things are gated here:
 *  1. the sweep NAMES the two sensors it skipped instead of staying silent;
 *  2. supplying both actually raises the drafts (2 kpi + 1 passport_gap);
 *  3. the headless KPI gatherer separates "unreadable" (undefined → skipped)
 *     from "read, all on track" ([] → a probe).
 */

const created: { origin: string }[] = [];

vi.mock('@/api/devTools/devTools', () => ({
  createFinding: vi.fn((input: { origin: string }) => {
    created.push(input);
    return Promise.resolve({ id: `idea-${created.length}` });
  }),
  listFindingDedupKeys: vi.fn(() => Promise.resolve([])),
  listStandards: vi.fn(() => Promise.resolve([])),
  listSkills: vi.fn(() => Promise.resolve([])),
  getSkillUsageOverview: vi.fn(() => Promise.resolve([])),
  getDocRotOverview: vi.fn(() => Promise.resolve([])),
  getMemoryDisputedOverview: vi.fn(() => Promise.resolve([])),
  setFindingVerifyState: vi.fn(() => Promise.resolve(true)),
  listContextGroups: vi.fn(() => Promise.resolve([])),
  listContexts: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/api/devTools/useCases', () => ({
  listUseCases: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/api/devTools/kpis', () => ({
  listKpis: vi.fn(() => Promise.resolve([])),
  listKpiMeasurementsBulk: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/features/plugins/dev-tools/sub_overview/adapters', () => ({
  fetchSentryUnresolvedIssues: vi.fn(() => Promise.resolve([])),
  splitSentrySlug: vi.fn(() => [null, null]),
}));

vi.mock('@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters', () => ({
  fetchLlmPinpoints: vi.fn(() => Promise.resolve([])),
  hasLiveAdapter: vi.fn(() => false),
}));

import { runFindingSweep } from '../sweep';
import { collectProjectKpiAttention } from '../sweepInputs';
import * as kpiApi from '@/api/devTools/kpis';
import * as devApi from '@/api/devTools/devTools';

const project = {
  id: 'p1',
  name: 'Demo',
  tech_stack: 'react',
  llm_tracking_credential_id: null,
  monitoring_credential_id: null,
  monitoring_project_slug: null,
} as unknown as DevProject;

const passport = { stack: 'react' } as never;

const planItem = (dimKey: string, projectId = 'p1'): PlanItem =>
  ({
    projectId,
    projectName: 'Demo',
    dimKey,
    dimLabel: dimKey,
    kind: 'standards',
    tier: 0,
    estGoldenLift: 6,
    priority: 6,
    passport,
  }) as unknown as PlanItem;

const offTrack = (id: string) => ({
  groupId: 'g1',
  kpiId: id,
  name: `kpi ${id}`,
  current: 10,
  target: 90,
  unit: '%',
});

beforeEach(() => {
  created.length = 0;
  vi.clearAllMocks();
});

describe('runFindingSweep sensor honesty', () => {
  it('names passport_gap and kpi as skipped when the caller supplies neither', async () => {
    const res = await runFindingSweep({ project, credentials: [], passport });
    expect(res.skippedSensors).toContain('passport_gap');
    expect(res.skippedSensors).toContain('kpi');
    expect(created.filter((c) => c.origin === 'kpi_offtrack')).toHaveLength(0);
    expect(created.filter((c) => c.origin === 'passport_gap')).toHaveLength(0);
  });

  it('raises 2 kpi_offtrack + 1 passport_gap when both inputs are supplied', async () => {
    const res = await runFindingSweep({
      project,
      credentials: [],
      passport,
      plan: [planItem('ci'), planItem('ci-other', 'other-project')],
      kpiAttention: [offTrack('k1'), offTrack('k2')],
    });
    expect(created.filter((c) => c.origin === 'kpi_offtrack')).toHaveLength(2);
    // The second plan item belongs to another project and must not leak in.
    expect(created.filter((c) => c.origin === 'passport_gap')).toHaveLength(1);
    expect(res.skippedSensors).not.toContain('passport_gap');
    expect(res.skippedSensors).not.toContain('kpi');
  });

  it('treats a supplied-but-empty attention list as a probe, not a skip', async () => {
    const res = await runFindingSweep({
      project,
      credentials: [],
      passport,
      kpiAttention: [],
    });
    expect(res.skippedSensors).not.toContain('kpi');
    expect(created.filter((c) => c.origin === 'kpi_offtrack')).toHaveLength(0);
  });
});

describe('collectProjectKpiAttention', () => {
  it('returns undefined (unreadable), never an empty array, when a read throws', async () => {
    vi.mocked(kpiApi.listKpis).mockRejectedValueOnce(new Error('db down'));
    const out = await collectProjectKpiAttention(project);
    expect(out).toBeUndefined();
  });

  it('returns an empty probe when the KPI tree is readable and holds nothing off track', async () => {
    const out = await collectProjectKpiAttention(project);
    expect(out).toEqual([]);
  });

  it('reads managed KPIs only, so a proposed KPI is never called off track', async () => {
    vi.mocked(devApi.listContextGroups).mockResolvedValueOnce([
      { id: 'g1', project_id: 'p1', name: 'G', domain: 'feature' },
    ] as never);
    vi.mocked(devApi.listContexts).mockResolvedValueOnce([
      { id: 'c1', project_id: 'p1', group_id: 'g1', name: 'C', category: 'ui' },
    ] as never);
    vi.mocked(kpiApi.listKpis).mockResolvedValueOnce([
      {
        id: 'k-proposed', project_id: 'p1', context_id: 'c1', group_id: 'g1', use_case_id: null,
        name: 'proposed', category: 'quality', tier: 'primary', unit: '%',
        target: 90, current: 1, direction: 'up', status: 'proposed',
      },
    ] as never);
    const out = await collectProjectKpiAttention(project);
    expect(out).toEqual([]);
  });
});
