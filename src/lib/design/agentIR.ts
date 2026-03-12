/**
 * AgentIR utilities -- factory, diff, and merge operations.
 *
 * These enable the universal interchange pipeline where every
 * creation/modification path converges on AgentIR, and operations
 * like diff, merge, version, and rollback become trivially possible.
 */

import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';

// -- Factory -----------------------------------------------------

/** Create a minimal empty AgentIR with all required fields initialized. */
export function emptyAgentIR(): AgentIR {
  return {
    structured_prompt: {
      identity: '',
      instructions: '',
      toolGuidance: '',
      examples: '',
      errorHandling: '',
      customSections: [],
    },
    suggested_tools: [],
    suggested_triggers: [],
    full_prompt_markdown: '',
    summary: '',
  };
}

// -- Diff --------------------------------------------------------

export interface AgentIRFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AgentIRDiff {
  changed: boolean;
  fields: AgentIRFieldDiff[];
  addedTools: string[];
  removedTools: string[];
  addedTriggers: SuggestedTrigger[];
  removedTriggers: SuggestedTrigger[];
  addedConnectors: string[];
  removedConnectors: string[];
}

/**
 * Compute a structural diff between two AgentIR instances.
 * Useful for versioning, change previews, and rollback decisions.
 */
export function diffAgentIR(before: AgentIR, after: AgentIR): AgentIRDiff {
  const fields: AgentIRFieldDiff[] = [];

  // Compare structured prompt sections
  const promptKeys = ['identity', 'instructions', 'toolGuidance', 'examples', 'errorHandling'] as const;
  for (const key of promptKeys) {
    if (before.structured_prompt[key] !== after.structured_prompt[key]) {
      fields.push({
        field: `structured_prompt.${key}`,
        before: before.structured_prompt[key],
        after: after.structured_prompt[key],
      });
    }
  }

  // Compare scalar fields
  if (before.full_prompt_markdown !== after.full_prompt_markdown) {
    fields.push({ field: 'full_prompt_markdown', before: before.full_prompt_markdown, after: after.full_prompt_markdown });
  }
  if (before.summary !== after.summary) {
    fields.push({ field: 'summary', before: before.summary, after: after.summary });
  }

  // Tools diff
  const beforeTools = new Set(before.suggested_tools);
  const afterTools = new Set(after.suggested_tools);
  const addedTools = after.suggested_tools.filter((t) => !beforeTools.has(t));
  const removedTools = before.suggested_tools.filter((t) => !afterTools.has(t));

  // Trigger diff (by description as identity key)
  const beforeTriggerKeys = new Set(before.suggested_triggers.map((t) => `${t.trigger_type}:${t.description}`));
  const afterTriggerKeys = new Set(after.suggested_triggers.map((t) => `${t.trigger_type}:${t.description}`));
  const addedTriggers = after.suggested_triggers.filter((t) => !beforeTriggerKeys.has(`${t.trigger_type}:${t.description}`));
  const removedTriggers = before.suggested_triggers.filter((t) => !afterTriggerKeys.has(`${t.trigger_type}:${t.description}`));

  // Connector diff
  const beforeConnectors = new Set((before.suggested_connectors ?? []).map((c) => c.name));
  const afterConnectors = new Set((after.suggested_connectors ?? []).map((c) => c.name));
  const addedConnectors = [...afterConnectors].filter((n) => !beforeConnectors.has(n));
  const removedConnectors = [...beforeConnectors].filter((n) => !afterConnectors.has(n));

  const changed = fields.length > 0 || addedTools.length > 0 || removedTools.length > 0
    || addedTriggers.length > 0 || removedTriggers.length > 0
    || addedConnectors.length > 0 || removedConnectors.length > 0;

  return { changed, fields, addedTools, removedTools, addedTriggers, removedTriggers, addedConnectors, removedConnectors };
}

// -- Merge -------------------------------------------------------

/**
 * Merge an overlay onto a base AgentIR. Overlay values take precedence.
 * Arrays are replaced (not concatenated) when present in the overlay.
 * Undefined overlay fields are skipped (base values preserved).
 */
export function mergeAgentIR(base: AgentIR, overlay: Partial<AgentIR>): AgentIR {
  const merged: AgentIR = { ...base };

  if (overlay.structured_prompt) {
    merged.structured_prompt = {
      ...base.structured_prompt,
      ...overlay.structured_prompt,
      customSections: overlay.structured_prompt.customSections ?? base.structured_prompt.customSections,
    };
  }

  if (overlay.suggested_tools) merged.suggested_tools = overlay.suggested_tools;
  if (overlay.suggested_triggers) merged.suggested_triggers = overlay.suggested_triggers;
  if (overlay.full_prompt_markdown !== undefined) merged.full_prompt_markdown = overlay.full_prompt_markdown;
  if (overlay.summary !== undefined) merged.summary = overlay.summary;
  if (overlay.design_highlights !== undefined) merged.design_highlights = overlay.design_highlights;
  if (overlay.suggested_connectors !== undefined) merged.suggested_connectors = overlay.suggested_connectors;
  if (overlay.suggested_notification_channels !== undefined) merged.suggested_notification_channels = overlay.suggested_notification_channels;
  if (overlay.feasibility !== undefined) merged.feasibility = overlay.feasibility;
  if (overlay.suggested_event_subscriptions !== undefined) merged.suggested_event_subscriptions = overlay.suggested_event_subscriptions;
  if (overlay.adoption_requirements !== undefined) merged.adoption_requirements = overlay.adoption_requirements;
  if (overlay.service_flow !== undefined) merged.service_flow = overlay.service_flow;
  if (overlay.protocol_capabilities !== undefined) merged.protocol_capabilities = overlay.protocol_capabilities;
  if (overlay.adoption_questions !== undefined) merged.adoption_questions = overlay.adoption_questions;

  return merged;
}
