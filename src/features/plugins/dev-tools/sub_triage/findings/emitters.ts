// The five finding emitters (docs/plans/dev-findings-loop.md §3 2B).
//
// Each is a PURE function over data the app already fetches — no IPC, no LLM, no
// clock. That's what makes them fixture-testable, and what lets Phase 3's
// verification probe re-run exactly one emitter against fresh inputs and compare
// the result to the `evidence` we recorded here.
//
// Contract for every emitter:
//   • `dedupKey` is stable and self-describing — the same underlying signal must
//     produce the same key forever, or dedup (and Phase-3 re-measurement) breaks.
//   • `evidence` carries the RAW NUMBERS the threshold decision was made on, so a
//     later probe can measure the same quantity and say "moved / unchanged".
//   • `description` is the task prompt seed — it must say what to DO, not just
//     what is wrong. It becomes a Claude-Code task if the idea is accepted.
import type { DevStandard } from '@/lib/bindings/DevStandard';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import type { PlanItem } from '@/features/teams/sub_factory/passport/improve/improvePlan';
import { findingPrompt } from '@/features/teams/sub_factory/passport/improve/findingFix';
import type { LlmPinpoint } from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import { slugifyUseCase } from '@/lib/useCaseSlug';

import type { FindingDraft, KpiAttention, SentryIssue } from './types';
import {
  LLM_COST_THRESHOLD_USD,
  PASSPORT_MAX_TIER,
  SENTRY_COUNT_THRESHOLD,
  SENTRY_TOP_N,
  UNNAMED_CALL_SHARE,
  UNNAMED_MIN_CALLS,
} from './findingConfig';

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

// ---------------------------------------------------------------------------
// E1 — golden-standard findings (the repo's own compliance gaps)
// ---------------------------------------------------------------------------

/** Open findings only (`status !== 'present'`), worst severity first. The
 *  recommendation IS the fix spec — `findingPrompt` already knows how to say so. */
export function emitStandardsFindings(
  findings: DevStandard[],
  passport: AppPassport,
): FindingDraft[] {
  const rank: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  return findings
    .filter((f) => f.status !== 'present')
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
    .map((f) => ({
      origin: 'standards_finding' as const,
      title: f.title,
      description: findingPrompt(f, passport),
      category: 'maintainability',
      evidence: {
        ruleKey: f.rule_key,
        severity: f.severity,
        status: f.status,
        repoEvidence: f.evidence,
      },
      dedupKey: `standards:${f.rule_key}`,
      // critical → do it now; info → nice to have.
      impact: f.severity === 'critical' ? 5 : f.severity === 'warn' ? 3 : 2,
      effort: 2,
      risk: 2,
    }));
}

// ---------------------------------------------------------------------------
// E2 — passport gaps (readiness dimensions below target)
// ---------------------------------------------------------------------------

/** The improve plan already ranks every below-target dimension by impact-per-
 *  effort. We raise only the LLM-actionable band (tier ≤ 2); tier 3 is a full
 *  Claude deploy and stays a deliberate human click on the passport. */
export function emitPassportGaps(plan: PlanItem[], projectId: string): FindingDraft[] {
  return plan
    .filter((it) => it.projectId === projectId && it.tier <= PASSPORT_MAX_TIER)
    .map((it) => ({
      origin: 'passport_gap' as const,
      title: `Raise ${it.dimLabel} to the golden standard`,
      description:
        `The project's ${it.dimLabel} dimension is below its golden-standard target. ` +
        `Closing it is worth ≈${round(it.estGoldenLift, 1)}% of the golden score ` +
        `(effort tier ${it.tier}). Bring ${it.dimLabel} up to target for this stack.`,
      category: 'maintainability',
      evidence: {
        dimKey: it.dimKey,
        tier: it.tier,
        estGoldenLift: round(it.estGoldenLift, 2),
        planPriority: round(it.priority, 2),
      },
      dedupKey: `passport:${it.dimKey}`,
      impact: it.estGoldenLift >= 5 ? 5 : it.estGoldenLift >= 2 ? 4 : 3,
      effort: it.tier + 1,
      risk: 2,
    }));
}

// ---------------------------------------------------------------------------
// E3 — LLM cost (the only sensor that measures REALITY, not code)
// ---------------------------------------------------------------------------

/**
 * Two distinct signals from one input:
 *  (a) a use case burning more than the threshold in the window → worth routing
 *      to a cheaper model / caching / trimming context;
 *  (b) too large a share of calls carrying NO use-case label → the call sites
 *      aren't instrumented, which is what blinds every other join in the app.
 *
 * `useCaseIdBySlug` maps an observed label onto the project's declared use case
 * so the finding can carry `useCaseId` (and Phase 3 can re-measure that slice).
 */
export function emitLlmCostFindings(
  pinpoints: LlmPinpoint[],
  window: string,
  useCaseIdBySlug: Map<string, string>,
): FindingDraft[] {
  const out: FindingDraft[] = [];
  if (pinpoints.length === 0) return out;

  // (a) expensive use cases
  for (const p of pinpoints) {
    if (p.useCaseName == null) continue;
    if (p.totalCostUsd <= LLM_COST_THRESHOLD_USD) continue;
    const slug = slugifyUseCase(p.useCaseName);
    out.push({
      origin: 'llm_cost',
      title: `“${p.useCaseName}” cost $${round(p.totalCostUsd, 2)} in ${window}`,
      description:
        `The use case “${p.useCaseName}” spent $${round(p.totalCostUsd, 2)} across ` +
        `${p.calls} ${p.provider}/${p.model} calls (${p.inputTokens + p.outputTokens} tokens) ` +
        `in the last ${window}. Investigate the call site: can it route to a cheaper model, ` +
        `cache repeated inputs, or send less context — without losing output quality?`,
      category: 'performance',
      useCaseId: useCaseIdBySlug.get(slug),
      evidence: {
        useCaseName: p.useCaseName,
        window,
        costUsd: round(p.totalCostUsd),
        calls: p.calls,
        tokens: p.inputTokens + p.outputTokens,
        provider: p.provider,
        model: p.model,
        thresholdUsd: LLM_COST_THRESHOLD_USD,
      },
      dedupKey: `llm:cost:${slug}`,
      impact: 4,
      effort: 3,
      risk: 3,
    });
  }

  // (b) uninstrumented call sites
  const totalCalls = pinpoints.reduce((s, p) => s + p.calls, 0);
  const unnamedCalls = pinpoints
    .filter((p) => p.useCaseName == null)
    .reduce((s, p) => s + p.calls, 0);
  const share = totalCalls > 0 ? unnamedCalls / totalCalls : 0;
  if (totalCalls >= UNNAMED_MIN_CALLS && share > UNNAMED_CALL_SHARE) {
    out.push({
      origin: 'llm_cost',
      title: `${Math.round(share * 100)}% of LLM calls have no use-case label`,
      description:
        `${unnamedCalls} of ${totalCalls} LLM calls in the last ${window} reached the tracer ` +
        `without a use-case name, so their cost can't be attributed to any feature. ` +
        `Pass a stable use-case name at each LLM call site (the tracer's name/label field) ` +
        `matching the project's declared use cases.`,
      category: 'maintainability',
      evidence: {
        window,
        totalCalls,
        unnamedCalls,
        share: round(share, 3),
        thresholdShare: UNNAMED_CALL_SHARE,
      },
      dedupKey: 'llm:unnamed',
      impact: 3,
      effort: 2,
      risk: 1,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// E4 — Sentry spikes
// ---------------------------------------------------------------------------

/** The loudest unresolved issues. `contextIdByCulprit` (built by the sweep from
 *  the context map's filePaths) lets a crash land on the code area that owns it. */
export function emitSentryFindings(
  issues: SentryIssue[],
  contextIdForCulprit: (culprit: string | null) => string | undefined,
): FindingDraft[] {
  return issues
    .filter((i) => i.count > SENTRY_COUNT_THRESHOLD)
    .sort((a, b) => b.count - a.count)
    .slice(0, SENTRY_TOP_N)
    .map((i) => ({
      origin: 'sentry_spike' as const,
      title: `Fix ${i.title}`,
      description:
        `Sentry reports this unresolved issue ${i.count} times` +
        (i.culprit ? ` in ${i.culprit}` : '') +
        `${i.lastSeen ? ` (last seen ${i.lastSeen})` : ''}. ` +
        `Reproduce it, find the root cause, and fix it. Issue: ${i.shortId} — ${i.title}`,
      category: 'reliability',
      contextId: contextIdForCulprit(i.culprit),
      evidence: {
        shortId: i.shortId,
        count: i.count,
        culprit: i.culprit,
        lastSeen: i.lastSeen,
        threshold: SENTRY_COUNT_THRESHOLD,
      },
      dedupKey: `sentry:${i.shortId}`,
      impact: 5,
      effort: 3,
      risk: 2,
    }));
}

// ---------------------------------------------------------------------------
// E5 — off-track KPIs
// ---------------------------------------------------------------------------

/** The same off-track set the Factory wall badges — see `collectKpiAttention` in
 *  sub_factory/factoryModel (extracted so both callers agree on "off track"). */
export function emitKpiFindings(attention: KpiAttention[]): FindingDraft[] {
  return attention.map((k) => ({
    origin: 'kpi_offtrack' as const,
    title: `KPI off track: ${k.name}`,
    description:
      `“${k.name}” is at ${k.current ?? 'no reading'}${k.unit} against a target of ` +
      `${k.target}${k.unit}. Find what moves this metric in the codebase and propose ` +
      `the change that closes the gap.`,
    category: 'performance',
    useCaseId: k.useCaseId,
    evidence: {
      kpiId: k.kpiId,
      groupId: k.groupId,
      name: k.name,
      current: k.current,
      target: k.target,
      unit: k.unit,
    },
    dedupKey: `kpi:${k.kpiId}`,
    impact: 4,
    effort: 3,
    risk: 2,
  }));
}
