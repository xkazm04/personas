// The findings sweep (docs/plans/dev-findings-loop.md §3 2C) — the one place that
// turns every sensor's current reading into triageable ideas.
//
// Shape: gather (tolerantly) → emit (pure) → dedup → cap → persist. Each sensor is
// optional: a project with no Sentry credential, no LLM tracer, or no standards
// scan still sweeps the sensors it DOES have, and names the ones it skipped. A
// sweep must never fail because one integration is down.
//
// Ordering is impact-per-effort, so when the cap bites, what survives is the work
// most worth doing — and the drop count is REPORTED, because a silent truncation
// reads as "nothing else to do".
import { createFinding, listFindingDedupKeys, listStandards } from '@/api/devTools/devTools';
import { listUseCases } from '@/api/devTools/useCases';
import type { DevProject } from '@/lib/bindings/DevProject';
import {
  fetchSentryUnresolvedIssues,
  splitSentrySlug,
} from '@/features/plugins/dev-tools/sub_overview/adapters';
import {
  fetchLlmPinpoints,
  hasLiveAdapter,
} from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import type { PlanItem } from '@/features/teams/sub_factory/passport/improve/improvePlan';
import { silentCatch } from '@/lib/silentCatch';

import {
  emitKpiFindings,
  emitLlmCostFindings,
  emitPassportGaps,
  emitSentryFindings,
  emitStandardsFindings,
} from './emitters';
import { SWEEP_CAP } from './findingConfig';
import type { FindingDraft, KpiAttention, SweepResult } from './types';

/** The only credential fields the sweep reads — accepts both the vault store's
 *  `CredentialMetadata` and a full `PersonaCredential`. */
export interface SweepCredential {
  id: string;
  serviceType: string;
}

/** Everything the sweep needs that it can't fetch itself (the Factory-side data
 *  lives in a React context, so the caller passes it in). */
export interface SweepInputs {
  project: DevProject;
  credentials: SweepCredential[];
  /** The project's passport — enables standards + passport-gap emitters. */
  passport?: AppPassport;
  /** The fleet improve plan (filtered to this project inside the emitter). */
  plan?: PlanItem[];
  /** Off-track KPIs (from `collectKpiAttention`). */
  kpiAttention?: KpiAttention[];
  /** contextId lookup by a Sentry culprit string — supplied by the context map. */
  contextIdForCulprit?: (culprit: string | null) => string | undefined;
}

/** Rank drafts by impact-per-effort so the cap keeps the best work. */
function score(d: FindingDraft): number {
  return (d.impact ?? 3) / Math.max(1, d.effort ?? 3);
}

export async function runFindingSweep(inputs: SweepInputs): Promise<SweepResult> {
  const { project, credentials, passport, plan, kpiAttention, contextIdForCulprit } = inputs;
  const drafts: FindingDraft[] = [];
  const skippedSensors: string[] = [];

  // -- E1/E2: the passport sensors (need a scan to have run) ------------------
  if (passport) {
    const standards = await listStandards(project.id).catch((e) => {
      silentCatch('findings/sweep:listStandards')(e);
      return [];
    });
    drafts.push(...emitStandardsFindings(standards, passport));
    if (plan) drafts.push(...emitPassportGaps(plan, project.id));
  } else {
    skippedSensors.push('passport');
  }

  // -- E3: LLM cost -----------------------------------------------------------
  const llmCredId = project.llm_tracking_credential_id;
  const llmCred = llmCredId ? credentials.find((c) => c.id === llmCredId) : undefined;
  if (llmCred && hasLiveAdapter(llmCred.serviceType)) {
    try {
      const pinpoints = await fetchLlmPinpoints(llmCred.serviceType, llmCred.id, '30d');
      const useCases = await listUseCases(project.id, 'active').catch(() => []);
      const idBySlug = new Map(useCases.map((u) => [u.slug, u.id]));
      drafts.push(...emitLlmCostFindings(pinpoints, '30d', idBySlug));
    } catch (e) {
      silentCatch('findings/sweep:llm')(e);
      skippedSensors.push('llm');
    }
  } else {
    skippedSensors.push('llm');
  }

  // -- E4: Sentry -------------------------------------------------------------
  const monCredId = project.monitoring_credential_id;
  const monCred = monCredId ? credentials.find((c) => c.id === monCredId) : undefined;
  const [orgSlug, projSlug] = splitSentrySlug(project.monitoring_project_slug);
  if (monCred && orgSlug && projSlug) {
    try {
      const issues = await fetchSentryUnresolvedIssues(monCred.id, orgSlug, projSlug);
      drafts.push(...emitSentryFindings(issues, contextIdForCulprit ?? (() => undefined)));
    } catch (e) {
      silentCatch('findings/sweep:sentry')(e);
      skippedSensors.push('sentry');
    }
  } else {
    skippedSensors.push('sentry');
  }

  // -- E5: KPIs ---------------------------------------------------------------
  if (kpiAttention && kpiAttention.length > 0) {
    drafts.push(...emitKpiFindings(kpiAttention));
  }

  // -- dedup against EVERY existing key (rejected included) --------------------
  const known = new Set(await listFindingDedupKeys(project.id));
  const fresh = drafts.filter((d) => !known.has(d.dedupKey));
  // A single sweep can emit the same key twice (two sensors, one signal) — keep
  // the first, which the score sort has already put on top.
  const seen = new Set<string>();
  const unique = fresh
    .sort((a, b) => score(b) - score(a))
    .filter((d) => (seen.has(d.dedupKey) ? false : (seen.add(d.dedupKey), true)));

  const keep = unique.slice(0, SWEEP_CAP);
  const dropped = unique.length - keep.length;

  let created = 0;
  for (const d of keep) {
    try {
      const idea = await createFinding({
        projectId: project.id,
        origin: d.origin,
        title: d.title,
        description: d.description,
        category: d.category,
        contextId: d.contextId,
        useCaseId: d.useCaseId,
        evidence: JSON.stringify(d.evidence),
        dedupKey: d.dedupKey,
        effort: d.effort,
        impact: d.impact,
        risk: d.risk,
      });
      // `null` = the backend's own dedup won the race with another sweep.
      if (idea) created += 1;
    } catch (e) {
      silentCatch('findings/sweep:createFinding')(e);
    }
  }

  return {
    created,
    duplicates: drafts.length - fresh.length,
    dropped,
    skippedSensors,
  };
}
