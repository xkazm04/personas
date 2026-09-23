/**
 * `CuratorPlan` -> the Blueprint's model.
 *
 * Pure, so a test can hold it to the honesty rules without a browser: an
 * unknown never becomes a zero, a measured zero and an unknown are different
 * marks, and the quiet tail comes from `CuratorPlan.quiet` rather than from
 * subtracting one figure from another.
 */
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import type { CuratorPlanItem } from '@/lib/bindings/CuratorPlanItem';

import { abbreviateDomains } from './abbreviate';
import { CHANNEL_ORDER, CHANNELS, DEMAND_FED, type ChannelId } from './channels';
import { markOfReason } from './parseClause';
import { driftOf, policyOf, type BlueprintSources } from './policy';
import type { BlueprintModel, BlueprintRow, CellMark, ChannelTotal } from './types';

export type { BlueprintSources } from './policy';

/** `at` always ends in the subject's own slug; the ledger shows only the taxonomy above it. */
function taxonomyOf(at: string, slug: string): string {
  const tail = `/${slug}`;
  return at.endsWith(tail) ? at.slice(0, -tail.length) : at;
}

function cellsOf(item: CuratorPlanItem): Record<ChannelId, CellMark> {
  const scored = new Map<ChannelId, CellMark>();
  for (const reason of item.reasons) {
    const mark = markOfReason(reason);
    if (mark) scored.set(mark.channel, { kind: 'scored', mark });
  }
  const out = {} as Record<ChannelId, CellMark>;
  for (const id of CHANNEL_ORDER) {
    const hit = scored.get(id);
    if (hit) {
      out[id] = hit;
      continue;
    }
    // Channels 1 and 7 are written by consumers. Where this subject's bundle
    // reports no demand, nobody has LOOKED - so the cell is unknown, and an
    // unknown is drawn as a thing you can see through, never as a zero.
    //
    // No arm here produces `unmeasurable`: the clock figures the projection
    // carries (`noClockApplications`) are CORPUS-wide, so "this subject's
    // applications carry no clock" is a claim the instrument cannot make. The
    // ink exists because the column head draws exactly that remainder, and
    // because the day a per-subject clock arrives the cell must become an
    // unmeasurable rather than quietly joining the measured zeros.
    out[id] = !item.demandKnown && DEMAND_FED.includes(id) ? { kind: 'unknown' } : { kind: 'measured-zero' };
  }
  return out;
}

function rowOf(item: CuratorPlanItem, order: number): BlueprintRow {
  const slug = item.subjectId.split('/').slice(1).join('/');
  return {
    id: item.subjectId,
    domain: item.domain,
    slug,
    taxonomy: taxonomyOf(item.at, slug),
    at: item.at,
    points: item.points,
    rank: 0,
    order,
    demandKnown: item.demandKnown,
    demand: item.demand,
    techniques: item.techniques,
    applications: item.applications,
    stacks: item.stacks,
    lastSwept: item.lastSwept,
    registryDryStreak: item.registryDryStreak,
    suppressedBySaturation: item.suppressedBySaturation,
    hasAppliedRow: item.hasAppliedRow,
    state: item.state,
    engine: item.engine,
    dominantReason: item.dominantReason,
    declinedReason: item.declinedReason,
    dispatchedRunId: item.dispatchedRunId,
    evidenceRef: item.evidenceRef,
    cells: cellsOf(item),
  };
}

/**
 * Why a column reads zero. Three different facts, three different marks:
 * the demand-fed channels are unasked wherever demand is unread; `expired`
 * cannot be asked of an application that carries no clock; anything else that
 * reads zero is a clean zero.
 */
function emptinessOf(channel: ChannelId, unknownBundles: number, noClock: number): ChannelTotal['emptiness'] {
  if (DEMAND_FED.includes(channel) && unknownBundles > 0) return 'unknown-remainder';
  if (channel === 3 && noClock > 0) return 'unmeasurable-remainder';
  return 'pure';
}

/**
 * What else the page reads, beside the plan.
 *
 * `policy` is the LIVE settings and `projects` the operator's consent per
 * checkout. Both are optional because both are separate doors that can fail
 * independently of the plan, and a page that refused to draw without them
 * would be hostage to the smaller read.
 */
export function buildModel(plan: CuratorPlan, sources: BlueprintSources = {}): BlueprintModel {
  const { run } = plan;
  const corpus = run.corpus;
  const rows = plan.items.map(rowOf);
  rows.sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  const unknownDemandBundles = Math.max(0, corpus.domains - corpus.demandKnownDomains.length);
  const totals = {} as Record<ChannelId, ChannelTotal>;
  for (const spec of CHANNELS) {
    let points = 0;
    let subjects = 0;
    for (const row of rows) {
      const cell = row.cells[spec.id];
      if (cell.kind === 'scored') {
        points += cell.mark.points;
        subjects += 1;
      }
    }
    totals[spec.id] = {
      channel: spec.id,
      points,
      subjects,
      emptiness: points > 0 ? null : emptinessOf(spec.id, unknownDemandBundles, corpus.noClockApplications),
    };
  }

  const quiet = plan.quiet.map((q) => ({ domain: q.domain, subjects: q.subjects, demandKnown: q.demandKnown }));
  const quietSubjects = quiet.reduce((a, q) => a + q.subjects, 0);
  const planPoints = rows.reduce((a, r) => a + r.points, 0);
  const reachBySlug = new Map(
    (sources.projects ?? []).map((p) => [p.slug, { enabled: p.enabled, consent: p.consentState }]),
  );
  const stored = policyOf(run.policy);
  const live = sources.policy ? policyOf(sources.policy) : null;
  const ceilings = rows.map((r) => {
    const cell = r.cells[7];
    return cell.kind === 'scored' ? (cell.mark.ceil ?? 0) : 0;
  });

  return {
    planRunId: run.id,
    createdAt: run.createdAt,
    scanGeneratedAt: run.scanGeneratedAt,
    registryHeadSha: run.registryHeadSha,
    subjects: corpus.subjects,
    techniques: corpus.techniques,
    applications: corpus.applications,
    domains: corpus.domains,
    noClockApplications: corpus.noClockApplications,
    expiredApplications: corpus.expiredApplications,
    atRiskApplications: corpus.atRiskApplications,
    driftUnknown: corpus.driftUnknown,
    drift: corpus.drift,
    demandKnownDomains: corpus.demandKnownDomains,
    unknownDemandBundles,
    bundleMark: abbreviateDomains([
      ...new Set([...rows.map((r) => r.domain), ...quiet.map((q) => q.domain)]),
    ]),
    rows,
    planPoints,
    maxPoints: Math.max(1, ...rows.map((r) => r.points)),
    maxCeiling: Math.max(1, ...ceilings),
    totals,
    quiet,
    quietSubjects,
    unlisted: Math.max(0, corpus.subjects - rows.length - quietSubjects),
    consumers: {
      projects: run.consumers.projects.map((p) => ({
        slug: p.slug,
        contexts: p.contexts,
        pairs: p.pairs,
        evaluated: p.evaluated,
        staleVerdicts: p.staleVerdicts,
        weak: p.weak,
        state: p.state,
        // `null` is "this door did not name the checkout", which is not the
        // same as "the operator refused it" and must not render as one.
        reach: reachBySlug.get(p.slug) ?? null,
      })),
      pairs: run.consumers.totals.pairs,
      evaluated: run.consumers.totals.evaluated,
      staleVerdicts: run.consumers.totals.staleVerdicts,
      weak: run.consumers.totals.weak,
      staleProjects: run.consumers.totals.staleProjects,
      mapsStale: run.consumers.mapsStale,
      problems: run.consumers.problems,
    },
    policy: stored,
    livePolicy: live,
    policyDrift: driftOf(stored, live),
  };
}
