import { describe, it, expect } from 'vitest';

import {
  emitKpiFindings,
  emitLlmCostFindings,
  emitPassportGaps,
  emitSentryFindings,
  emitStandardsFindings,
} from '../emitters';
import {
  LLM_COST_THRESHOLD_USD,
  SENTRY_COUNT_THRESHOLD,
  SENTRY_TOP_N,
  UNNAMED_MIN_CALLS,
} from '../findingConfig';
import type { SentryIssue } from '../types';
import type { LlmPinpoint } from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import type { DevStandard } from '@/lib/bindings/DevStandard';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import type { PlanItem } from '@/features/teams/sub_factory/passport/improve/improvePlan';

// A passport only needs the fields `findingPrompt`'s stack line reads.
const passport = {
  identity: { name: 'Acme', slug: 'p1', purpose: '', archetype: 'solo', lifecycle: 'beta', criticality: 'internal' },
  stack: { languages: [{ name: 'TypeScript', primary: true }], frameworks: [], monitoring: {}, integrations: [] },
  automationReadiness: { level: 'L3', score: 60, blockers: [] },
  productionReadiness: { band: 'beta', score: 55, blockers: [] },
} as unknown as AppPassport;

function pinpoint(over: Partial<LlmPinpoint>): LlmPinpoint {
  return {
    useCaseName: 'summarize',
    provider: 'anthropic',
    model: 'claude-opus',
    calls: 10,
    inputTokens: 1000,
    outputTokens: 200,
    totalCostUsd: 1,
    costIsEstimate: true,
    ...over,
  };
}

function standard(over: Partial<DevStandard>): DevStandard {
  return {
    id: 's1',
    project_id: 'p1',
    scan_id: null,
    rule_key: 'lint.config',
    category: 'code_quality',
    title: 'Formatter absent',
    status: 'missing',
    severity: 'warn',
    evidence: null,
    recommendation: 'Add prettier',
    created_at: '',
    updated_at: '',
    ...over,
  } as DevStandard;
}

describe('emitStandardsFindings', () => {
  it('emits only open findings, worst severity first, keyed by rule', () => {
    const out = emitStandardsFindings(
      [
        standard({ rule_key: 'a', status: 'present', severity: 'critical' }), // compliant → skip
        standard({ rule_key: 'b', status: 'missing', severity: 'info' }),
        standard({ rule_key: 'c', status: 'partial', severity: 'critical' }),
      ],
      passport,
    );
    expect(out.map((f) => f.dedupKey)).toEqual(['standards:c', 'standards:b']);
    expect(out[0]!.origin).toBe('standards_finding');
    expect(out[0]!.impact).toBe(5); // critical
    expect(out[0]!.evidence).toMatchObject({ ruleKey: 'c', severity: 'critical' });
    // the description must be actionable — it seeds the Claude task prompt
    expect(out[0]!.description).toMatch(/Recommendation|implement the fix/i);
  });
});

describe('emitPassportGaps', () => {
  const item = (over: Partial<PlanItem>): PlanItem =>
    ({ projectId: 'p1', projectName: 'Acme', dimKey: 'tests', dimLabel: 'Tests', kind: 'task', tier: 1, estGoldenLift: 6, priority: 3, passport, ...over }) as PlanItem;

  it('keeps only this project and only the LLM-actionable tiers (≤2)', () => {
    const out = emitPassportGaps(
      [
        item({ dimKey: 'tests', tier: 1 }),
        item({ dimKey: 'deploy', tier: 3 }), // too expensive → human decision
        item({ dimKey: 'ci', tier: 0, projectId: 'other' }), // different project
      ],
      'p1',
    );
    expect(out.map((f) => f.dedupKey)).toEqual(['passport:tests']);
    expect(out[0]!.evidence).toMatchObject({ dimKey: 'tests', tier: 1 });
  });
});

describe('emitLlmCostFindings', () => {
  const idBySlug = new Map([['summarize', 'uc-1']]);

  it('flags a use case over the cost threshold and links it to its use case', () => {
    const out = emitLlmCostFindings(
      [
        pinpoint({ useCaseName: 'summarize', totalCostUsd: LLM_COST_THRESHOLD_USD + 3 }),
        pinpoint({ useCaseName: 'cheap', totalCostUsd: 0.01 }),
      ],
      '30d',
      idBySlug,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.dedupKey).toBe('llm:cost:summarize');
    expect(out[0]!.useCaseId).toBe('uc-1');
    expect(out[0]!.evidence).toMatchObject({ costUsd: LLM_COST_THRESHOLD_USD + 3, model: 'claude-opus' });
  });

  it('flags uninstrumented call sites when unnamed share is too high', () => {
    const out = emitLlmCostFindings(
      [
        pinpoint({ useCaseName: null, calls: UNNAMED_MIN_CALLS, totalCostUsd: 0.5 }),
        pinpoint({ useCaseName: 'named', calls: 1, totalCostUsd: 0.5 }),
      ],
      '30d',
      idBySlug,
    );
    const unnamed = out.find((f) => f.dedupKey === 'llm:unnamed');
    expect(unnamed).toBeDefined();
    expect(unnamed!.evidence).toMatchObject({ unnamedCalls: UNNAMED_MIN_CALLS });
  });

  it('stays quiet on a small, well-labelled, cheap project', () => {
    expect(emitLlmCostFindings([pinpoint({ calls: 2, totalCostUsd: 0.01 })], '30d', idBySlug)).toEqual([]);
  });

  it('returns nothing for no telemetry', () => {
    expect(emitLlmCostFindings([], '30d', idBySlug)).toEqual([]);
  });
});

describe('emitSentryFindings', () => {
  const issue = (over: Partial<SentryIssue>): SentryIssue => ({
    id: '1', shortId: 'ACME-1', title: 'TypeError', culprit: 'src/a.ts', count: 100, lastSeen: null, ...over,
  });

  it('keeps only issues over the threshold, loudest first, capped at TOP_N', () => {
    const issues = Array.from({ length: SENTRY_TOP_N + 3 }, (_, i) =>
      issue({ shortId: `E-${i}`, count: SENTRY_COUNT_THRESHOLD + 10 * (i + 1) }),
    );
    issues.push(issue({ shortId: 'QUIET', count: SENTRY_COUNT_THRESHOLD - 1 }));
    const out = emitSentryFindings(issues, () => 'ctx-1');
    expect(out).toHaveLength(SENTRY_TOP_N);
    expect(out.map((f) => f.dedupKey)).not.toContain('sentry:QUIET');
    // loudest first
    expect(out[0]!.evidence).toMatchObject({ count: SENTRY_COUNT_THRESHOLD + 10 * (SENTRY_TOP_N + 3) });
    expect(out[0]!.contextId).toBe('ctx-1');
  });

  it('survives a culprit that matches no context', () => {
    const out = emitSentryFindings([issue({ count: 999, culprit: null })], () => undefined);
    expect(out[0]!.contextId).toBeUndefined();
    expect(out[0]!.origin).toBe('sentry_spike');
  });
});

describe('emitKpiFindings', () => {
  it('maps each off-track KPI to a finding keyed by KPI id', () => {
    const out = emitKpiFindings([
      { groupId: 'g1', kpiId: 'k1', name: 'p95 latency', current: 900, target: 300, unit: 'ms', useCaseId: 'uc-9' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.dedupKey).toBe('kpi:k1');
    expect(out[0]!.useCaseId).toBe('uc-9');
    expect(out[0]!.evidence).toMatchObject({ current: 900, target: 300 });
  });

  it('handles an unmeasured KPI without rendering undefined', () => {
    const out = emitKpiFindings([
      { groupId: 'g1', kpiId: 'k2', name: 'conversion', current: null, target: 5, unit: '%' },
    ]);
    expect(out[0]!.description).not.toMatch(/undefined|null/);
  });
});
