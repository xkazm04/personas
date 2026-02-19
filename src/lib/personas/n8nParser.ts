import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { N8nWorkflow, N8nNode } from '@/lib/types/templateTypes';

const N8N_SERVICE_MAP: Record<string, string> = {
  gmail: 'gmail',
  slack: 'slack',
  github: 'github',
  postgres: 'postgres',
  notion: 'notion',
  webhook: 'webhook',
  cron: 'schedule',
  httprequest: 'http',
  airtable: 'airtable',
  googlesheets: 'google-sheets',
  discord: 'discord',
  jira: 'jira',
  telegram: 'telegram',
  twitter: 'twitter',
  dropbox: 'dropbox',
  mongodb: 'mongodb',
  mysql: 'mysql',
  redis: 'redis',
  s3: 'aws-s3',
  sqs: 'aws-sqs',
  stripe: 'stripe',
  twilio: 'twilio',
  sendgrid: 'sendgrid',
  openai: 'openai',
};

function extractServiceName(nodeType: string): string {
  // e.g. "n8n-nodes-base.gmailTrigger" → "gmail"
  const parts = nodeType.split('.');
  const nodeName = parts[parts.length - 1] || nodeType;
  const lower = nodeName.toLowerCase().replace(/trigger$/, '');

  for (const [key, value] of Object.entries(N8N_SERVICE_MAP)) {
    if (lower.startsWith(key) || lower === key) return value;
  }
  return lower;
}

function isTriggerNode(node: N8nNode): boolean {
  return /trigger/i.test(node.type) || /trigger/i.test(node.name);
}

export function parseN8nWorkflow(json: unknown): DesignAnalysisResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid n8n workflow: expected an object');
  }

  const workflow = json as N8nWorkflow;
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    throw new Error('Invalid n8n workflow: no nodes found');
  }

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
