/**
 * Shared extraction pipeline for workflow parsers.
 *
 * Each platform parser defines a small adapter that normalizes its
 * platform-specific JSON into a common intermediate form. This pipeline
 * then runs the identical classification -> tool naming -> connector
 * building -> prompt assembly algorithm, producing a AgentIR.
 */

import type { AgentIR } from '@/lib/types/designTypes';
import type { PlatformDefinition, ProtocolMapRule } from '../platformDefinitions';
import { extractProtocolsFromNodes } from '../platformDefinitions';
import { sanitizeTextField, sanitizeParamValue } from '@/lib/utils/sanitizers/workflowSanitizer';
import { createLogger } from '@/lib/log';
import { trackInteraction } from '@/lib/sentry';

const logger = createLogger('workflow-import');

/**
 * Report node types this platform's table has no mapping for.
 *
 * This is the ranked backlog for new `nodeTypeMap` rows, and the pipeline is
 * the only place that knows it — at the exact moment it happens. It was
 * recorded nowhere, so the table grew from whatever anyone happened to notice.
 * Only the raw TYPE strings travel (`n8n-nodes-base.acmeWidget`), never a node
 * label, a parameter or anything the user wrote.
 */
function reportUnmappedTypes(def: PlatformDefinition | undefined, nodes: NormalizedNode[]): void {
  if (!def) return;
  const known = new Set(def.nodeTypeMap.map((m) => m.targetService));
  const unmapped = [...new Set(
    nodes.filter((n) => !known.has(n.service)).map((n) => n.rawType),
  )];
  if (unmapped.length === 0) return;

  logger.info('unmapped node types', { platform: def.id, count: unmapped.length, types: unmapped });
  for (const type of unmapped) {
    trackInteraction('workflow_import', 'unmapped_type', `${def.id}:${type}`);
  }
}

// -- Adapter interface -------------------------------------------

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
  /** Trigger type override -- if not provided, inferred from service name */
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

// -- Pipeline ----------------------------------------------------

/**
 * Length caps for untrusted text lowered into the IR. Sized to match
 * `workflowSanitizer`'s own `MAX_LENGTHS.workflowName` / `.nodeName`, so a
 * "description" cannot smuggle a ten-thousand-token payload into a prompt.
 */
const MAX_NAME_LEN = 200;
const MAX_LABEL_LEN = 150;

/**
 * Run the shared extraction pipeline on an adapter result.
 *
 * This is the single algorithm that all parsers share. Each parser
 * calls its adapter to produce an `AdapterResult`, then passes it here.
 */
export function runExtractionPipeline(adapter: AdapterResult): AgentIR {
  const { platformLabel, platformNoun, elementNoun } = adapter;
  const excludedServices = new Set(adapter.excludedServices ?? []);

  // Every string below originates in a file the user downloaded from a foreign
  // product — attacker-grade input wearing a colleague's name — and every one of
  // them is interpolated into `structured_prompt` / `full_prompt_markdown`, i.e.
  // straight into a model prompt. Sanitizing HERE, at the waist all four
  // adapters lower through, is the single door: previously only the n8n adapter
  // sanitized (workflowSanitizer.ts still documents itself as being about "n8n
  // workflows"), so a Zapier / Make / GitHub Actions export carrying
  // `## SYSTEM ... ignore all previous instructions` reached the prompt intact.
  // `sanitizeTextField` (not `sanitizeName`) is deliberate: it neutralizes
  // prompt STRUCTURE — headings, fences, role lines, zero-width characters —
  // while leaving ordinary text in any script alone, so a Japanese or Russian
  // workflow name survives rather than being emptied by an ASCII allowlist.
  const workflowName = sanitizeTextField(adapter.workflowName, MAX_NAME_LEN);
  // `config` is the one field that arrives as a whole foreign object rather
  // than a string: n8n `node.parameters`, Zapier `step.params`, Make
  // `mod.mapper`, GitHub Actions `step.with`. It was copied through untouched
  // into `suggested_triggers[].config`, where it is persisted and later
  // rendered — the only value in the IR that never met the sanitizer.
  // `sanitizeParamValue` is the recursive form of the same door: it caps depth,
  // breadth and value length and runs every key through `sanitizeParamKey`.
  const nodes: NormalizedNode[] = adapter.nodes.map((node) => ({
    ...node,
    label: sanitizeTextField(node.label, MAX_LABEL_LEN) || node.service || 'step',
    sourceDescription: node.sourceDescription
      ? sanitizeTextField(node.sourceDescription, MAX_LABEL_LEN)
      : node.sourceDescription,
    config: node.config
      ? (sanitizeParamValue(node.config) as Record<string, unknown>)
      : node.config,
  }));

  reportUnmappedTypes(adapter.platformDef, nodes);

  const triggerNodes = nodes.filter((n) => n.isTrigger);
  const actionNodes = nodes.filter((n) => !n.isTrigger && !n.isExcluded);
  const services = new Set<string>();

  // Build triggers. `triggerServices` is index-aligned with `triggers` so a
  // connector can claim its triggers by identity instead of by scanning the
  // human-readable description for its own name (which cross-linked any
  // service whose name is a substring of another — "mail" claimed "gmail").
  const triggerServices: string[] = [];
  const triggers = triggerNodes.map((node) => {
    services.add(node.service);
    triggerServices.push(node.service);
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

  // Add fallback triggers if none detected. Synthetic triggers belong to no
  // service, so they stay unclaimed by every connector.
  if (triggers.length === 0 && adapter.fallbackTriggers) {
    // Make's fallback carries the scenario's raw `scheduling` object, so this
    // path is foreign data too — it goes through the same door.
    triggers.push(...adapter.fallbackTriggers.map((t) => ({
      ...t,
      config: sanitizeParamValue(t.config ?? {}) as Record<string, unknown>,
    })));
    for (const _ of adapter.fallbackTriggers) triggerServices.push('');
  }

  // Build tool names, keeping each tool's owning service alongside it.
  const tools = actionNodes.map((node) => {
    services.add(node.service);
    const safeName = node.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return { service: node.service, name: `${node.service}_${safeName}` };
  });
  const toolNames = tools.map((t) => t.name);

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
      related_tools: tools.filter((t) => t.service === service).map((t) => t.name),
      related_triggers: triggerServices
        .map((s, i) => (s === service ? i : -1))
        .filter((i) => i >= 0),
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
