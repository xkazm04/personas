/* ==============================================================================
   Plan Builder
   Generates a HarnessPlan from a scenario definition.
   Handles dependency resolution and topological sorting.
   ============================================================================== */

import type {
  HarnessPlan,
  HarnessConfig,
  ModuleArea,
  PlannedFeature,
  ScenarioArea,
  ScenarioDefinition,
} from './types';

// ---------------------------------------------------------------------------
//  Plan Generation
// ---------------------------------------------------------------------------

export function buildPlan(config: HarnessConfig, scenario: ScenarioDefinition): HarnessPlan {
  const sorted = topologicalSort(scenario.areas);

  const areas: ModuleArea[] = sorted.map((sa) => ({
    id: sa.id,
    moduleId: sa.moduleId,
    label: sa.label,
    description: sa.description,
    scope: sa.scope,
    featureNames: sa.features,
    dependsOn: sa.dependsOn,
    status: 'pending',
    features: sa.features.map((name) => featureFromName(sa.id, name)),
    completedAt: null,
    retries: 0,
  }));

  const totalFeatures = areas.reduce((sum, a) => sum + a.features.length, 0);

  return {
    project: config.projectName,
    projectPath: config.projectPath,
    scenario: config.scenario,
    areas,
    iteration: 0,
    totalFeatures,
    passingFeatures: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
//  Area Selection (dependency-aware)
// ---------------------------------------------------------------------------

export function pickNextArea(plan: HarnessPlan): ModuleArea | null {
  for (const area of plan.areas) {
    if (area.status !== 'pending') continue;

    const depsResolved = area.dependsOn.every((depId) => {
      const dep = plan.areas.find((a) => a.id === depId);
      return dep && dep.status === 'completed';
    });

    if (depsResolved) return area;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Stats Update
// ---------------------------------------------------------------------------

export function updatePlanStats(plan: HarnessPlan): void {
  plan.passingFeatures = plan.areas.reduce(
    (sum, a) => sum + a.features.filter((f) => f.status === 'pass').length,
    0,
  );
  plan.updatedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function featureFromName(areaId: string, name: string): PlannedFeature {
  return {
    id: `${areaId}::${name}`,
    name,
    status: 'pending',
    quality: null,
    lastSession: null,
    failReason: null,
  };
}

function topologicalSort(areas: ScenarioArea[]): ScenarioArea[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const visited = new Set<string>();
  const sorted: ScenarioArea[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const area = byId.get(id);
    if (!area) return;
    for (const dep of area.dependsOn) {
      visit(dep);
    }
    sorted.push(area);
  }

  for (const area of areas) {
    visit(area.id);
  }

  return sorted;
}
