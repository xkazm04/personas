/**
 * Shared extraction pipeline for workflow parsers.
 *
 * Each platform parser defines a small adapter that normalizes its
 * platform-specific JSON into a common intermediate form. This pipeline
 * then runs the identical classification → tool naming → connector
 * building → prompt assembly algorithm, producing a AgentIR.
 */

import type { AgentIR } from '@/lib/types/designTypes';
import type { PlatformDefinition, ProtocolMapRule } from './platformDefinitions';
import { extractProtocolsFromNodes } from './platformDefinitions';

// ── Adapter interface ───────────────────────────────────────────

/** A normalized workflow node from any platform. */
export interface NormalizedNode {
  /** Display label for the node (e.g. "Send Slack Message") */
  label: string;
  /** The resolved service name (e.g. "slack", "gmail") */
  service: string;
  /** Whether this node is a trigger */
  isTrigger: boolean;
  /** Whether this node should be excluded from connectors/tools (e.g. routers) */
  isExcluded?: boolean;
  /** Trigger type override — if not provided, inferred from service name */
  triggerType?: 'manual' | 'schedule' | 'polling' | 'webhook';
  /** Config payload for the trigger */
  config?: Record<string, unknown>;
  /** Platform-specific description suffix (e.g. "from n8n gmailTrigger") */
  sourceDescription?: string;
  /** Raw node type string for protocol extraction */
  rawType: string;
}

/** Result of a platform adapter's extraction. */
export interface AdapterResult {
  /** The platform label (e.g. "n8n", "Zapier", "Make (Integromat)") */
  platformLabel: string;
  /** The platform noun for summaries (e.g. "workflow", "Zap", "scenario") */
  platformNoun: string;
  /** The element noun (e.g. "nodes", "steps", "modules") */
  elementNoun: string;
  /** Extracted workflow name */
  workflowName: string;
  /** All normalized nodes in order */
  nodes: NormalizedNode[];
  /** Services to exclude from connector generation */
  excludedServices?: string[];
  /** Fallback triggers if none were detected */
  fallbackTriggers?: Array<{
    trigger_type: 'manual' | 'schedule' | 'polling' | 'webhook';
    config: Record<string, unknown>;
    description: string;
  }>;
  /** The platform definition (for protocol extraction). Omit for platforms without one. */
  platformDef?: PlatformDefinition;
  /** Protocol capabilities (for platforms that compute them directly) */
  protocolCapabilities?: { type: ProtocolMapRule['targetProtocol']; label: string; context: string }[];
}

// ── Pipeline ────────────────────────────────────────────────────

/**
 * Run the shared extraction pipeline on an adapter result.
 *
 * This is the single algorithm that all parsers share. Each parser
 * calls its adapter to produce an `AdapterResult`, then passes it here.
 */
export function runExtractionPipeline(adapter: AdapterResult): AgentIR {
  const { platformLabel, platformNoun, elementNoun, workflowName, nodes } = adapter;
  const excludedServices = new Set(adapter.excludedServices ?? []);

  const triggerNodes = nodes.filter((n) => n.isTrigger);
  const actionNodes = nodes.filter((n) => !n.isTrigger && !n.isExcluded);
  const services = new Set<string>();

  // Build triggers
  const triggers = triggerNodes.map((node) => {
    services.add(node.service);
    const triggerType = node.triggerType
      ?? (node.service === 'schedule' ? 'schedule'
        : node.service === 'webhook' ? 'webhook'
          : 'polling');
    return {
      trigger_type: triggerType as 'manual' | 'schedule' | 'polling' | 'webhook',
      config: (node.config ?? {}) as Record<string, unknown>,
      description: node.sourceDescription
        ? `${node.label} (from ${platformLabel} ${node.sourceDescription})`
        : `${node.label} (from ${platformLabel})`,
    };
  });

  // Add fallback triggers if none detected
  if (triggers.length === 0 && adapter.fallbackTriggers) {
    triggers.push(...adapter.fallbackTriggers);
  }

  // Build tool names
  const toolNames = actionNodes.map((node) => {
    services.add(node.service);
    const safeName = node.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `${node.service}_${safeName}`;
  });

  // Build connectors from unique services (excluding platform-internal ones)
  const connectors = Array.from(services)
    .filter((s) => !excludedServices.has(s))
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

  // Protocol capabilities
  let protocol_capabilities = adapter.protocolCapabilities;
  if (!protocol_capabilities && adapter.platformDef) {
    const rawTypes = nodes.map((n) => n.rawType);
    const extracted = extractProtocolsFromNodes(adapter.platformDef, rawTypes);
    protocol_capabilities = extracted.length > 0 ? extracted : undefined;
  }

  // Build node sequence string
  const nodeSequence = nodes.map((n) => n.label).join(' \u2192 ');

  // Build step list for instructions
  const stepList = nodes
    .map((n, i) => `${i + 1}. ${n.label} (${n.service})`)
    .join('\n');

  const totalCount = nodes.length;

  return {
    structured_prompt: {
      identity: `You are an AI agent that orchestrates the "${workflowName}" workflow, originally designed in ${platformLabel}.`,
      instructions: `Execute the following workflow steps in order:\n${stepList}\n\nFollow the data flow between steps, passing outputs from each step as inputs to the next.`,
      toolGuidance: actionNodes.length > 0
        ? `Use the following tools in sequence: ${actionNodes.map((n) => n.label).join(', ')}.`
        : 'No specific tools required.',
      examples: '',
      errorHandling: 'If any step fails, log the error and attempt to continue with the remaining steps. Report all failures in your final output.',
      customSections: [],
    },
    suggested_tools: toolNames,
    suggested_triggers: triggers,
    full_prompt_markdown: `# ${workflowName}\n\nWorkflow: ${nodeSequence}\n\nThis persona was imported from ${platformLabel === 'GitHub Actions' ? 'a' : platformLabel.startsWith('a') || platformLabel.startsWith('A') ? 'an' : 'a'} ${platformLabel} ${platformNoun} with ${totalCount} ${elementNoun}.`,
    summary: `Imported from ${platformLabel} ${platformNoun} "${workflowName}" with ${totalCount} ${elementNoun} (${triggerNodes.length} triggers, ${actionNodes.length} actions).`,
    suggested_connectors: connectors,
    protocol_capabilities: protocol_capabilities || undefined,
  };
}
