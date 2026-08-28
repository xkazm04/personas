import type { AgentIR } from '@/lib/types/designTypes';
import type { N8nNode } from '@/lib/types/templateTypes';
import { N8N_DEFINITION, resolveNodeType, classifyNodeRole } from '../platformDefinitions';
import { runExtractionPipeline, type NormalizedNode } from './workflowPipeline';

function isValidNode(value: unknown): value is N8nNode {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && obj.type.length > 0
    && typeof obj.name === 'string' && obj.name.length > 0;
}

export function parseN8nWorkflow(json: unknown): AgentIR {
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

  const nodes: NormalizedNode[] = validNodes.map((node) => {
    const service = resolveNodeType(N8N_DEFINITION, node.type);
    const isTrigger = classifyNodeRole(N8N_DEFINITION, node.type) === 'trigger';
    return {
      // Raw on purpose. `runExtractionPipeline` is the single sanitization
      // waist all four adapters lower through and it applies
      // `sanitizeTextField`, which neutralizes prompt STRUCTURE while leaving
      // ordinary text in any script intact. n8n additionally ran
      // `sanitizeName` here first — an ASCII allowlist that DELETED every
      // other character, so a node called Отправить сообщение arrived at the waist as an
      // empty string and the imported persona listed an unnamed step. Dropping
      // it relaxes nothing: the waist strips the same injection patterns.
      label: node.name,
      service,
      isTrigger,
      config: (node.parameters || {}) as Record<string, unknown>,
      sourceDescription: node.type,
      rawType: node.type,
    };
  });

  return runExtractionPipeline({
    platformLabel: 'n8n',
    platformNoun: 'workflow',
    elementNoun: 'nodes',
    workflowName: typeof raw.name === 'string' ? raw.name : 'Imported n8n Workflow',
    nodes,
    platformDef: N8N_DEFINITION,
  });
}
