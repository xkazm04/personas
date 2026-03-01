/**
 * Parser for Make (Integromat) blueprint exports.
 * Converts Make scenario JSON into DesignAnalysisResult.
 *
 * Make exports typically have:
 * - `flow` array with module objects containing `module`, `type`, `mapper` fields
 * - Or wrapped in a `blueprint` key
 * - Or `modules` at top level
 */

import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { MAKE_DEFINITION, toServiceMap, classifyNodeRole } from './platformDefinitions';

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

const MAKE_SERVICE_MAP = toServiceMap(MAKE_DEFINITION);

function extractServiceName(moduleId: string | undefined): string {
  if (!moduleId) return 'unknown';
  const lower = moduleId.toLowerCase();

  // Make module IDs often follow pattern: "app:ActionName" or "builtin:Router"
  const colonPart = lower.split(':')[0] || lower;
  const cleaned = colonPart.replace(/[^a-z0-9-]/g, '');

  for (const [key, value] of Object.entries(MAKE_SERVICE_MAP)) {
    if (cleaned.includes(key)) return value;
  }
  return cleaned || 'unknown';
}

function isTriggerModule(mod: MakeModule): boolean {
  if (!mod.module && !mod.type) return false;
  const role = classifyNodeRole(MAKE_DEFINITION, mod.module || mod.type || '');
  return role === 'trigger';
}

function isRouterModule(mod: MakeModule): boolean {
  const role = classifyNodeRole(MAKE_DEFINITION, mod.module || mod.type || '');
  return role === 'decision';
}

export function parseMakeWorkflow(json: unknown): DesignAnalysisResult {
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

  // Flatten nested module arrays (Make uses nested structures for routes)
  const flatModules = flattenModules(modules);

  if (flatModules.length === 0) {
    throw new Error('Invalid Make blueprint: no modules found');
  }

  const triggerModules = flatModules.filter(isTriggerModule);
  const actionModules = flatModules.filter((m) => !isTriggerModule(m) && !isRouterModule(m));
  const services = new Set<string>();

  const triggers = triggerModules.map((mod) => {
    const service = extractServiceName(mod.module);
    services.add(service);
    const triggerType =
      service === 'webhook' ? 'webhook'
        : (mod.module || '').toLowerCase().includes('schedule') ? 'schedule'
          : 'polling';
    return {
      trigger_type: triggerType as 'manual' | 'schedule' | 'polling' | 'webhook',
      config: (mod.mapper || mod.parameters || {}) as Record<string, unknown>,
      description: `${mod.label || mod.name || mod.module || 'Trigger'} (from Make ${mod.module || 'module'})`,
    };
  });

  if (triggers.length === 0) {
    // Check for scheduling info
    const hasSchedule = scenario.scheduling && Object.keys(scenario.scheduling).length > 0;
    triggers.push({
      trigger_type: hasSchedule ? 'schedule' : 'manual',
      config: hasSchedule ? (scenario.scheduling as Record<string, unknown>) : {},
      description: hasSchedule ? 'Scheduled trigger (from Make scenario scheduling)' : 'Manual trigger (no Make trigger detected)',
    });
  }

  const toolNames = actionModules.map((mod) => {
    const service = extractServiceName(mod.module);
    services.add(service);
    const label = (mod.label || mod.name || mod.module || 'action').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `${service}_${label}`;
  });

  const connectors = Array.from(services)
    .filter((s) => !['json', 'csv', 'unknown'].includes(s))
    .map((service) => ({
      name: service,
      credential_fields: [] as Array<{
        key: string;
        label: string;
        type: 'text' | 'password' | 'url';
        placeholder?: string;
        helpText?: string;
        required?: boolean;
      }>,
      related_tools: toolNames.filter((t) => t.startsWith(service)),
      related_triggers: triggers
        .map((t, i) => ({ desc: t.description, index: i }))
        .filter((t) => t.desc.toLowerCase().includes(service))
        .map((t) => t.index),
    }));

  const workflowName = scenario.name || scenario.blueprint?.name || 'Imported Make Scenario';
  const moduleSequence = flatModules.map((m) => m.label || m.name || m.module || '?').join(' \u2192 ');

  return {
    structured_prompt: {
      identity: `You are an AI agent that orchestrates the "${workflowName}" workflow, originally designed in Make (Integromat).`,
      instructions: `Execute the following workflow steps in order:\n${flatModules.map((m, i) => `${i + 1}. ${m.label || m.name || m.module || 'Module'} (${extractServiceName(m.module)})`).join('\n')}\n\nFollow the data flow between modules, passing outputs from each module as inputs to the next.`,
      toolGuidance: actionModules.length > 0
        ? `Use the following tools in sequence: ${actionModules.map((m) => m.label || m.name || m.module || 'action').join(', ')}.`
        : 'No specific tools required.',
      examples: '',
      errorHandling: 'If any module fails, log the error and attempt to continue with the remaining modules. Report all failures in your final output.',
      customSections: [],
    },
    suggested_tools: toolNames,
    suggested_triggers: triggers,
    full_prompt_markdown: `# ${workflowName}\n\nWorkflow: ${moduleSequence}\n\nThis persona was imported from a Make scenario with ${flatModules.length} modules.`,
    summary: `Imported from Make scenario "${workflowName}" with ${flatModules.length} modules (${triggerModules.length} triggers, ${actionModules.length} actions).`,
    suggested_connectors: connectors,
  };
}

/** Recursively flatten nested Make module structures */
function flattenModules(modules: MakeModule[]): MakeModule[] {
  const result: MakeModule[] = [];
  for (const mod of modules) {
    result.push(mod);
    // Make routers may contain nested route arrays
    const record = mod as Record<string, unknown>;
    if (Array.isArray(record.routes)) {
      for (const route of record.routes as Array<Record<string, unknown>>) {
        if (Array.isArray(route.flow)) {
          result.push(...flattenModules(route.flow as MakeModule[]));
        }
        if (Array.isArray(route.modules)) {
          result.push(...flattenModules(route.modules as MakeModule[]));
        }
      }
    }
  }
  return result;
}
