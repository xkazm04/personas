/**
 * Parser for Zapier Zap exports.
 * Converts Zapier workflow JSON into DesignAnalysisResult.
 *
 * Zapier exports typically have:
 * - `steps` array with `app`, `action`, `params` fields
 * - Or `trigger` + `actions` pattern
 */

import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { ZAPIER_DEFINITION, toServiceMap, classifyNodeRole } from './platformDefinitions';

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

export function parseZapierWorkflow(json: unknown): DesignAnalysisResult {
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

  const triggerSteps = allSteps.filter(isTriggerStep);
  const actionSteps = allSteps.filter((s) => !isTriggerStep(s));
  const services = new Set<string>();

  const triggers = triggerSteps.map((step) => {
    const service = extractServiceName(step.app);
    services.add(service);
    const triggerType =
      service === 'schedule' ? 'schedule'
        : service === 'webhook' ? 'webhook'
          : 'polling';
    return {
      trigger_type: triggerType as 'manual' | 'schedule' | 'polling' | 'webhook',
      config: (step.params || {}) as Record<string, unknown>,
      description: `${step.label || step.action || step.app || 'Trigger'} (from Zapier ${step.app || 'app'})`,
    };
  });

  // If no explicit triggers, add a manual one
  if (triggers.length === 0) {
    triggers.push({
      trigger_type: 'manual',
      config: {},
      description: 'Manual trigger (no Zapier trigger detected)',
    });
  }

  const toolNames = actionSteps.map((step) => {
    const service = extractServiceName(step.app);
    services.add(service);
    const label = (step.label || step.action || step.app || 'action').toLowerCase().replace(/\s+/g, '_');
    return `${service}_${label}`;
  });

  const connectors = Array.from(services)
    .filter((s) => !['formatter', 'filter', 'code', 'unknown'].includes(s))
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

  const workflowName = zap.title || zap.name || 'Imported Zapier Zap';
  const stepSequence = allSteps.map((s) => s.label || s.action || s.app || '?').join(' \u2192 ');

  return {
    structured_prompt: {
      identity: `You are an AI agent that orchestrates the "${workflowName}" workflow, originally designed in Zapier.`,
      instructions: `Execute the following workflow steps in order:\n${allSteps.map((s, i) => `${i + 1}. ${s.label || s.action || s.app || 'Step'} (${extractServiceName(s.app)})`).join('\n')}\n\nFollow the data flow between steps, passing outputs from each step as inputs to the next.`,
      toolGuidance: actionSteps.length > 0
        ? `Use the following tools in sequence: ${actionSteps.map((s) => s.label || s.action || s.app || 'action').join(', ')}.`
        : 'No specific tools required.',
      examples: '',
      errorHandling: 'If any step fails, log the error and attempt to continue with the remaining steps. Report all failures in your final output.',
      customSections: [],
    },
    suggested_tools: toolNames,
    suggested_triggers: triggers,
    full_prompt_markdown: `# ${workflowName}\n\nWorkflow: ${stepSequence}\n\nThis persona was imported from a Zapier Zap with ${allSteps.length} steps.`,
    summary: `Imported from Zapier Zap "${workflowName}" with ${allSteps.length} steps (${triggerSteps.length} triggers, ${actionSteps.length} actions).`,
    suggested_connectors: connectors,
  };
}
