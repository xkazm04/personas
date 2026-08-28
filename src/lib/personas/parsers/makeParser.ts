/**
 * Parser for Make (Integromat) blueprint exports.
 * Converts Make scenario JSON into AgentIR.
 */

import type { AgentIR } from '@/lib/types/designTypes';
import { MAKE_DEFINITION, resolveService, classifyNodeRole } from '../platformDefinitions';
import { runExtractionPipeline, type NormalizedNode } from './workflowPipeline';

interface MakeModule {
  module?: string;
  type?: string;
  name?: string;
  label?: string;
  mapper?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface MakeExport {
  name?: string;
  flow?: MakeModule[];
  modules?: MakeModule[];
  blueprint?: {
    name?: string;
    flow?: MakeModule[];
    modules?: MakeModule[];
  };
  scheduling?: Record<string, unknown>;
}

function extractServiceName(moduleId: string | undefined): string {
  return resolveService(MAKE_DEFINITION, moduleId);
}

export function parseMakeWorkflow(json: unknown): AgentIR {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid Make blueprint: expected an object');
  }

  const scenario = json as MakeExport;

  // Normalize: extract modules from various formats
  let modules: MakeModule[];
  if (scenario.blueprint) {
    modules = scenario.blueprint.flow || scenario.blueprint.modules || [];
  } else {
    modules = scenario.flow || scenario.modules || [];
  }

  const flatModules = flattenModules(modules);

  if (flatModules.length === 0) {
    throw new Error('Invalid Make blueprint: no modules found');
  }

  const nodes: NormalizedNode[] = flatModules.map((mod) => {
    const service = extractServiceName(mod.module);
    const role = classifyNodeRole(MAKE_DEFINITION, mod.module || mod.type || '');
    return {
      label: mod.label || mod.name || mod.module || 'Module',
      service,
      isTrigger: role === 'trigger',
      isExcluded: role === 'decision',
      config: (mod.mapper || mod.parameters || {}) as Record<string, unknown>,
      sourceDescription: mod.module || 'module',
      rawType: mod.module || mod.type || '',
    };
  });

  // Build fallback trigger based on scheduling info
  const hasSchedule = scenario.scheduling && Object.keys(scenario.scheduling).length > 0;
  const fallbackTriggers = [{
    trigger_type: (hasSchedule ? 'schedule' : 'manual') as 'manual' | 'schedule',
    config: hasSchedule ? (scenario.scheduling as Record<string, unknown>) : {},
    description: hasSchedule
      ? 'Scheduled trigger (from Make scenario scheduling)'
      : 'Manual trigger (no Make trigger detected)',
  }];

  return runExtractionPipeline({
    platformLabel: 'Make (Integromat)',
    platformNoun: 'scenario',
    elementNoun: 'modules',
    workflowName: scenario.name || scenario.blueprint?.name || 'Imported Make Scenario',
    nodes,
    excludedServices: ['json', 'csv', 'unknown'],
    fallbackTriggers,
    platformDef: MAKE_DEFINITION,
  });
}

/** Recursively flatten nested Make module structures */
function flattenModules(modules: MakeModule[]): MakeModule[] {
  const result: MakeModule[] = [];
  const visitedLists = new Set<unknown>();
  const MAX_NESTED_DEPTH = 64;

  const walk = (list: MakeModule[], depth: number) => {
    if (depth > MAX_NESTED_DEPTH) return;
    if (visitedLists.has(list)) return;
    visitedLists.add(list);

    for (const mod of list) {
      result.push(mod);
      const record = mod as Record<string, unknown>;
      if (!Array.isArray(record.routes)) continue;

      for (const route of record.routes as Array<Record<string, unknown>>) {
        if (Array.isArray(route.flow)) {
          walk(route.flow as MakeModule[], depth + 1);
        }
        if (Array.isArray(route.modules)) {
          walk(route.modules as MakeModule[], depth + 1);
        }
      }
    }
  };

  walk(modules, 0);
  return result;
}
