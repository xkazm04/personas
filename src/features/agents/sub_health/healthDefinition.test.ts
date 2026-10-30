/**
 * One agent, one health verdict. The editor badge (`useHealthCheck`) and the
 * weekly digest (`runFullHealthDigest`) used to grade the same agent by two
 * definitions - the badge by design feasibility, the digest by live telemetry -
 * so an agent with healthy telemetry and no stored design read "degraded 75"
 * in the editor and "healthy 100" in the digest, under the same word.
 *
 * Both IPC doors the old badge used are mocked the way the backend answers, so
 * this test exercises whichever definition each surface really reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';

const { mockConfigWarnings } = vi.hoisted(() => ({ mockConfigWarnings: vi.fn() }));

vi.mock('@/api/design/design', () => ({
  // The backend's check_feasibility: a payload without structured_prompt
  // reports "Missing structured_prompt section".
  testDesignFeasibility: vi.fn(async (json: string) => {
    const val = JSON.parse(json) as Record<string, unknown>;
    const issues = val.structured_prompt == null ? ['Missing structured_prompt section'] : [];
    return { overall: issues.length ? 'partial' : 'ready', confirmed_capabilities: [], issues };
  }),
}));
vi.mock('@/api/pipeline/triggers', () => ({
  getPersonaConfigWarnings: (id: string) => mockConfigWarnings(id),
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ credentials: [] }) },
}));

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useHealthCheck } from './useHealthCheck';
import { computeHealthScore } from './healthScoring';

const persona = {
  id: 'p1', name: 'Courier', icon: null, color: null,
  design_context: null, last_design_result: null, structured_prompt: null,
} as unknown as Persona;

function healthySignal(): PersonaHealthSignal {
  return {
    personaId: 'p1', rollbackCount: 0, budgetRatio: 0.1, projectedExhaustionDays: null,
    healingFrequency: 0, failureTrend: 'stable', successRate: 99, successRateSource: 'executions',
    totalExecutions: 40, recentExecutions: 12, predictedFailureInDays: null, avgLatencyMs: 900,
  } as unknown as PersonaHealthSignal;
}

beforeEach(() => {
  mockConfigWarnings.mockReset().mockResolvedValue([]);
  useOverviewStore.setState({
    refreshHealthDashboard: vi.fn(async () => {}),
    healthSignals: [healthySignal()],
    healthHealingIssues: [],
    healthError: null,
  } as never);
  useAgentStore.setState({ personas: [persona], selectedPersona: persona } as never);
});

async function badgeScore() {
  const { result } = renderHook(() => useHealthCheck());
  await act(async () => {
    await result.current.runHealthCheck(persona);
  });
  return result.current.score;
}

describe('agent health has one definition', () => {
  it('gives the editor badge and the weekly digest the same verdict for the same agent', async () => {
    const badge = await badgeScore();
    const digest = await useAgentStore.getState().runFullHealthDigest();
    const digestScore = computeHealthScore(digest!.personas[0]!.result.issues);

    expect(badge).toEqual(digestScore);
    expect(badge).toEqual({ value: 100, grade: 'healthy' });
  });

  it('carries config warnings into both surfaces, not only the badge', async () => {
    mockConfigWarnings.mockResolvedValue([
      { id: 'w1', severity: 'warning', category: 'chain_trigger', description: "Chain trigger 't1' has an empty config" },
    ]);
    const badge = await badgeScore();
    const digest = await useAgentStore.getState().runFullHealthDigest();
    const descriptions = digest!.personas[0]!.result.issues.map((i) => i.description);

    expect(descriptions).toContain("Chain trigger 't1' has an empty config");
    expect(badge).toEqual(computeHealthScore(digest!.personas[0]!.result.issues));
    expect(badge?.value).toBe(90);
  });

  it('reports a config-warning outage as undetermined, never as a penalty on the agent', async () => {
    mockConfigWarnings.mockRejectedValue(new Error('door down'));
    const digest = await useAgentStore.getState().runFullHealthDigest();
    const issues = digest!.personas[0]!.result.issues;

    expect(issues.map((i) => i.severity)).toEqual(['undetermined']);
    expect(digest!.undeterminedCount).toBe(1);
    expect(digest!.personas[0]!.result.status).toBe('ready');
    expect(computeHealthScore(issues).value).toBe(100);
  });

  it('fails the check instead of grading stale telemetry when the health pipeline errored', async () => {
    useOverviewStore.setState({ healthError: 'health bundle unavailable' } as never);
    const { result } = renderHook(() => useHealthCheck());
    await act(async () => {
      await result.current.runHealthCheck(persona);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('health bundle unavailable');
    expect(await useAgentStore.getState().runFullHealthDigest()).toBeNull();
  });
});
