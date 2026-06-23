// The Improve Plan — turns the diagnostic matrix into a prioritised, fleet-wide
// remediation program. Every below-target dimension across every project becomes
// a ranked PlanItem scored by IMPACT-PER-EFFORT: the golden-% it would unlock
// (from the rubric weight + gap) divided by the action's tier cost (config <
// scan < connector < deploy). The result answers "what's the single best thing
// to do next, across all my apps?" — and the LLM-actionable items batch-queue.
import { derivePassportFromMetadata } from '../passportDerive';
import { scoreAgainstRubric, RUBRIC } from './goldenStandard';
import { applicableDeployActions, type DeployAction } from './deployActions';
import type { ImproveRaw } from './ImproveContext';
import type { AppPassport } from '../passportModel';

export type PlanKind = 'scan' | 'task' | 'connector' | 'standards' | 'skills';

export interface PlanItem {
  projectId: string;
  projectName: string;
  dimKey: string;
  dimLabel: string;
  kind: PlanKind;
  /** Effort tier: 0 config · 1 scan · 2 connector/skills · 3 Claude deploy. */
  tier: number;
  /** Golden-% this project gains if this dimension reaches its target. */
  estGoldenLift: number;
  /** estGoldenLift ÷ effort — the ranking key. */
  priority: number;
  /** Present for scan/task kinds → one-click queue / run. */
  action?: DeployAction;
  passport: AppPassport;
}

// Which lever closes each dimension's gap (+ its effort tier). `deployRow` links
// to the DeployAction catalog for the one-click items.
const DIM_ACTION: Record<string, { kind: PlanKind; tier: number; deployRow?: string }> = {
  context: { kind: 'scan', tier: 1, deployRow: 'context' },
  instructions: { kind: 'task', tier: 3, deployRow: 'instructions' },
  tests: { kind: 'task', tier: 3, deployRow: 'tests' },
  security: { kind: 'task', tier: 3, deployRow: 'security' },
  evals: { kind: 'task', tier: 3, deployRow: 'evals' },
  migrations: { kind: 'task', tier: 3, deployRow: 'migrations' },
  observability: { kind: 'connector', tier: 2 },
  aiflow: { kind: 'connector', tier: 2 },
  skills: { kind: 'skills', tier: 2 },
  ci: { kind: 'standards', tier: 0 },
  selfverify: { kind: 'standards', tier: 0 },
};

const SUM_W = RUBRIC.reduce((a, d) => a + d.weight, 0);

function passportOf(raw: ImproveRaw): AppPassport {
  return derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence });
}

/** Every below-target gap across the fleet, ranked by impact-per-effort. */
export function buildImprovePlan(raws: ImproveRaw[]): PlanItem[] {
  const items: PlanItem[] = [];
  for (const raw of raws) {
    const p = passportOf(raw);
    const r = scoreAgainstRubric(p);
    for (const dim of r.belowTarget) {
      const map = DIM_ACTION[dim.key];
      if (!map) continue;
      const weight = RUBRIC.find((d) => d.key === dim.key)?.weight ?? 1;
      const estGoldenLift = Math.round((weight * (1 - dim.progress) / SUM_W) * 100);
      if (estGoldenLift <= 0) continue;
      const action = map.deployRow ? applicableDeployActions(map.deployRow, p)[0] : undefined;
      // A 'task'/'scan' dim with no catalog action available is dropped — nothing to offer.
      if ((map.kind === 'task' || map.kind === 'scan') && !action) continue;
      items.push({
        projectId: raw.project.id, projectName: raw.project.name,
        dimKey: dim.key, dimLabel: dim.label, kind: map.kind, tier: map.tier,
        estGoldenLift, priority: estGoldenLift / (map.tier + 1), action, passport: p,
      });
    }
  }
  return items.sort((a, b) => b.priority - a.priority);
}

/** Current mean golden-% across the fleet. */
export function fleetGoldenAvg(raws: ImproveRaw[]): number {
  if (raws.length === 0) return 0;
  const sum = raws.reduce((a, raw) => a + scoreAgainstRubric(passportOf(raw)).goldenPct, 0);
  return Math.round(sum / raws.length);
}

/** Projected fleet mean if the given plan items all reached target (per-project capped at 100). */
export function projectedFleetGolden(raws: ImproveRaw[], chosen: PlanItem[]): number {
  if (raws.length === 0) return 0;
  const liftByProject = new Map<string, number>();
  for (const it of chosen) liftByProject.set(it.projectId, (liftByProject.get(it.projectId) ?? 0) + it.estGoldenLift);
  const sum = raws.reduce((a, raw) => {
    const base = scoreAgainstRubric(passportOf(raw)).goldenPct;
    return a + Math.min(100, base + (liftByProject.get(raw.project.id) ?? 0));
  }, 0);
  return Math.round(sum / raws.length);
}
