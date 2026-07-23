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
import {
  createFinding,
  getDocRotOverview,
  getMemoryDisputedOverview,
  getSkillUsageOverview,
  listFindingDedupKeys,
  listSkills,
  listStandards,
  setFindingVerifyState,
} from '@/api/devTools/devTools';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevTask } from '@/lib/bindings/DevTask';
import { verdictFor, verifiableFindings } from './verify';
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
  emitDocRotFindings,
  emitKpiFindings,
  emitLlmCostFindings,
  emitMemoryDisputedFindings,
  emitPassportGaps,
  emitSentryFindings,
  emitSkillDormantFindings,
  emitStandardsFindings,
  type DormantSkill,
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
  /** The project's ideas + tasks — enables VERIFICATION (Phase 3A). Omit to sweep
   *  without judging (the emitters still run; nothing gets a verdict). */
  ideas?: DevIdea[];
  tasks?: DevTask[];
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

  // -- E6: dormant skills (P1 transcript telemetry) ----------------------------
  // Installed = this project's .claude/skills; a skill provided only globally
  // counts through its global registry row. Empty telemetry (never mined /
  // older build) yields zero rows → the sensor is skipped, never guessed.
  try {
    const [usage, installed] = await Promise.all([
      getSkillUsageOverview(),
      listSkills(project.id).catch(() => []),
    ]);
    if (usage.length === 0) {
      skippedSensors.push('skills');
    } else {
      const installedNames = new Set(installed.map((s) => s.name));
      const rows: DormantSkill[] = usage
        .filter((r) => !r.missing_since)
        .filter((r) =>
          r.scope === 'project' ? r.project_id === project.id : installedNames.has(r.name),
        )
        .map((r) => ({
          name: r.name,
          scope: r.scope,
          first_seen_at: r.first_seen_at,
          last_invoked_at: r.last_invoked_at,
          dormant: r.dormant,
        }));
      drafts.push(...emitSkillDormantFindings(rows));
    }
  } catch (e) {
    silentCatch('findings/sweep:skills')(e);
    skippedSensors.push('skills');
  }

  // -- E7: doc rot (P2 git-derived dirty tracking) ------------------------------
  // Empty overview for this project = the rot scan never ran (or no docs) —
  // the sensor is skipped, never guessed.
  try {
    const rot = (await getDocRotOverview()).filter((r) => r.project_id === project.id);
    if (rot.length === 0) {
      skippedSensors.push('docs');
    } else {
      drafts.push(...emitDocRotFindings(rot));
    }
  } catch (e) {
    silentCatch('findings/sweep:docs')(e);
    skippedSensors.push('docs');
  }

  // -- E8: disputed memories (P3 claims loop) -----------------------------------
  // Zero rows is a HEALTHY state, not a skipped sensor — the overview command
  // itself degrades to [] only on older builds, which safeInvoke masks the
  // same way, so this sensor never invents disputes either way.
  try {
    const disputed = (await getMemoryDisputedOverview()).filter((m) => m.project_id === project.id);
    drafts.push(...emitMemoryDisputedFindings(disputed));
  } catch (e) {
    silentCatch('findings/sweep:memory')(e);
    skippedSensors.push('memory');
  }

  // -- VERIFY (Phase 3A) ------------------------------------------------------
  // The drafts we just emitted ARE the probe: an emitter only fires when a signal
  // is over threshold, so a finding whose dedup_key is missing from this fresh set
  // has had its signal go away. Judge before dedup filtering — we need every fresh
  // draft here, including the ones dedup is about to drop as "already known"
  // (a still-known finding is exactly the `unchanged`/`regressed` case).
  const verified = { cleared: 0, moved: 0, unchanged: 0, regressed: 0 };
  if (inputs.ideas && inputs.tasks) {
    const freshByKey = new Map(drafts.map((d) => [d.dedupKey, d]));
    for (const f of verifiableFindings(inputs.ideas, inputs.tasks)) {
      const verdict = verdictFor(f, freshByKey.get(f.dedup_key ?? ''));
      try {
        await setFindingVerifyState(f.id, verdict.state, JSON.stringify(verdict.evidence));
        if (verdict.state !== 'pending') verified[verdict.state] += 1;
      } catch (e) {
        silentCatch('findings/sweep:setVerifyState')(e);
      }
    }
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
    verified,
  };
}
