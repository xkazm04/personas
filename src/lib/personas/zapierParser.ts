/**
 * Parser for Zapier Zap exports.
 * Converts Zapier workflow JSON into AgentIR.
 */

import type { AgentIR } from '@/lib/types/designTypes';
import { ZAPIER_DEFINITION, toServiceMap, classifyNodeRole } from './platformDefinitions';
import { runExtractionPipeline, type NormalizedNode } from './workflowPipeline';

interface ZapierStep {
  app?: string;
  action?: string;
  action_id?: string;
  params?: Record<string, unknown>;
  label?: string;
  type?: string;
}

interface ZapierExport {
  title?: string;
  name?: string;
  steps?: ZapierStep[];
  trigger?: ZapierStep;
  actions?: ZapierStep[];
}

const ZAPIER_SERVICE_MAP = toServiceMap(ZAPIER_DEFINITION);

function extractServiceName(app: string | undefined): string {
  if (!app) return 'unknown';
  const lower = app.toLowerCase().replace(/[^a-z0-9-]/g, '');
  for (const [key, value] of Object.entries(ZAPIER_SERVICE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return lower;
}

function isTriggerStep(step: ZapierStep): boolean {
  if (step.type === 'trigger') return true;
  if (step.action?.toLowerCase().includes('trigger')) return true;
  if (classifyNodeRole(ZAPIER_DEFINITION, step.app || '') === 'trigger') return true;
  return false;
}

export function parseZapierWorkflow(json: unknown): AgentIR {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid Zapier export: expected an object');
  }

  const zap = json as ZapierExport;

  // Normalize steps from either format
  let allSteps: ZapierStep[] = [];
  if (Array.isArray(zap.steps) && zap.steps.length > 0) {
    allSteps = zap.steps;
  } else {
    if (zap.trigger) allSteps.push({ ...zap.trigger, type: 'trigger' });
    if (Array.isArray(zap.actions)) allSteps.push(...zap.actions);
  }

  if (allSteps.length === 0) {
    throw new Error('Invalid Zapier export: no steps found');
  }

  const nodes: NormalizedNode[] = allSteps.map((step) => {
    const service = extractServiceName(step.app);
    const isTrigger = isTriggerStep(step);
    return {
      label: step.label || step.action || step.app || (isTrigger ? 'Trigger' : 'Action'),
      service,
      isTrigger,
      config: (step.params || {}) as Record<string, unknown>,
      sourceDescription: step.app || 'app',
      rawType: step.app || step.action || '',
    };
  });

  return runExtractionPipeline({
    platformLabel: 'Zapier',
    platformNoun: 'Zap',
    elementNoun: 'steps',
    workflowName: zap.title || zap.name || 'Imported Zapier Zap',
    nodes,
    excludedServices: ['formatter', 'filter', 'code', 'unknown'],
    fallbackTriggers: [{
      trigger_type: 'manual',
      config: {},
      description: 'Manual trigger (no Zapier trigger detected)',
    }],
    platformDef: ZAPIER_DEFINITION,
  });
}
