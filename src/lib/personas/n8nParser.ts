import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { N8nWorkflow, N8nNode } from '@/lib/types/templateTypes';
import { N8N_DEFINITION, resolveNodeType, classifyNodeRole } from './platformDefinitions';

function extractServiceName(nodeType: string): string {
  return resolveNodeType(N8N_DEFINITION, nodeType);
}

function isTriggerNode(node: N8nNode): boolean {
  return classifyNodeRole(N8N_DEFINITION, node.type) === 'trigger';
}

function isValidNode(value: unknown): value is N8nNode {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && obj.type.length > 0
    && typeof obj.name === 'string' && obj.name.length > 0;
}

export function parseN8nWorkflow(json: unknown): DesignAnalysisResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid n8n workflow: expected an object');
  }

  const raw = json as Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error('Invalid n8n workflow: no nodes found');
  }

  const validNodes = raw.nodes.filter(isValidNode);
  if (validNodes.length === 0) {
    throw new Error('Invalid n8n workflow: no valid nodes found (nodes must have type and name)');
  }

  const workflow: N8nWorkflow = {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    nodes: validNodes,
    connections: (typeof raw.connections === 'object' && raw.connections !== null
      ? raw.connections
      : {}) as N8nWorkflow['connections'],
  };

  const triggerNodes = workflow.nodes.filter(isTriggerNode);
  const actionNodes = workflow.nodes.filter(n => !isTriggerNode(n));
  const services = new Set<string>();

  const triggers = triggerNodes.map(node => {
    const service = extractServiceName(node.type);
    services.add(service);
    const triggerType = service === 'schedule' || service === 'webhook' ? service : 'polling';
    return {
      trigger_type: triggerType as 'manual' | 'schedule' | 'polling' | 'webhook',
      config: (node.parameters || {}) as Record<string, unknown>,
      description: `${node.name} (from n8n ${node.type})`,
    };
  });

  const toolNames = actionNodes.map(node => {
    const service = extractServiceName(node.type);
    services.add(service);
    return `${service}_${node.name.toLowerCase().replace(/\s+/g, '_')}`;
  });

  const connectors = Array.from(services).map(service => ({
    name: service,
    oauth_type: undefined as string | undefined,
    credential_fields: [] as Array<{
      key: string;
      label: string;
      type: 'text' | 'password' | 'url';
      placeholder?: string;
      helpText?: string;
      required?: boolean;
    }>,
    related_tools: toolNames.filter(t => t.startsWith(service)),
    related_triggers: triggers
      .map((t, i) => ({ desc: t.description, index: i }))
      .filter(t => t.desc.toLowerCase().includes(service))
      .map(t => t.index),
  }));

  const nodeSequence = workflow.nodes.map(n => n.name).join(' \u2192 ');
  const workflowName = workflow.name || 'Imported n8n Workflow';

  return {
    structured_prompt: {
      identity: `You are an AI agent that orchestrates the "${workflowName}" workflow, originally designed in n8n.`,
      instructions: `Execute the following workflow steps in order:\n${workflow.nodes.map((n, i) => `${i + 1}. ${n.name} (${extractServiceName(n.type)})`).join('\n')}\n\nFollow the data flow between steps, passing outputs from each step as inputs to the next.`,
      toolGuidance: actionNodes.length > 0
        ? `Use the following tools in sequence: ${actionNodes.map(n => n.name).join(', ')}.`
        : 'No specific tools required.',
      examples: '',
      errorHandling: 'If any step fails, log the error and attempt to continue with the remaining steps. Report all failures in your final output.',
      customSections: [],
    },
    suggested_tools: toolNames,
    suggested_triggers: triggers,
    full_prompt_markdown: `# ${workflowName}\n\nWorkflow: ${nodeSequence}\n\nThis persona was imported from an n8n workflow with ${workflow.nodes.length} nodes.`,
    summary: `Imported from n8n workflow "${workflowName}" with ${workflow.nodes.length} nodes (${triggerNodes.length} triggers, ${actionNodes.length} actions).`,
    suggested_connectors: connectors,
  };
}
