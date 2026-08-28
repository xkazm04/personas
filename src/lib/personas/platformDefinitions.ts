/**
 * Config-driven platform definitions for workflow import.
 *
 * Each platform's node-type mappings, credential consolidation rules, and role
 * classifications are defined here as data rather than scattered across
 * individual parsers.
 *
 * ## This is a CACHED COPY of the Rust table, not a mirror of it
 *
 * This header used to read "Mirrors the Rust PlatformDefinition struct". It
 * does not, and saying so hid two real divergences (measured 2026-08-28):
 *
 * 1. **Shape.** `ProtocolMapRule` below requires `nodePatterns: string[]`.
 *    The Rust `ProtocolMapRule` (`src-tauri/core/src/models/platform_definition.rs`,
 *    built by `pm()` in `src-tauri/engine/src/platform_rules.rs`) has only
 *    `platform_pattern` / `target_protocol` / `condition` — there is no
 *    `node_patterns` field and nothing generates one. A rule that came from the
 *    backend therefore has `nodePatterns === undefined`.
 * 2. **Contents.** The two tables have drifted independently — each side
 *    carries platform entries and patterns the other lacks.
 *
 * Nothing in the app currently feeds a backend-sourced definition into these
 * functions (`get_platform_definition` has no call sites), so this is latent,
 * not live. It is guarded rather than assumed: `extractProtocolsFromNodes`
 * tolerates a missing `nodePatterns`, and `@/api/platforms/platformDefinitions`
 * validates the IPC payload at the boundary instead of asserting it.
 *
 * When you change either table, change the other in the same PR — nothing
 * compares them.
 */

// -- Types ------------------------------------------------------

export interface NodeTypeMapping {
  sourcePattern: string;
  targetService: string;
}

export interface CredentialConsolidationRule {
  sourcePatterns: string[];
  targetConnector: string;
  description: string;
}

export interface NodeRolePattern {
  pattern: string;
  role: 'trigger' | 'tool' | 'decision' | 'llm' | 'utility';
}

export interface ProtocolMapRule {
  /** Human-readable description of matching node types (documentation only) */
  platformPattern: string;
  targetProtocol: 'user_message' | 'agent_memory' | 'manual_review' | 'emit_event';
  condition: string;
  /**
   * Concrete node-type substrings to match (same matching as
   * nodeRoleClassification).
   *
   * **TS-only — the Rust `ProtocolMapRule` has no counterpart field.** Required
   * here because every locally-authored definition supplies it; a definition
   * that arrived over IPC will not, which is why every reader must go through
   * {@link protocolNodePatterns}.
   */
  nodePatterns: string[];
}

/**
 * The node-type substrings a protocol rule matches on, or `[]` when the rule
 * came from a source that does not carry them (see the note on
 * {@link ProtocolMapRule.nodePatterns}).
 *
 * An empty list means "this rule never matches structurally" — the keyword
 * prompt-scan fallback still applies — which is the right degradation. Reading
 * `rule.nodePatterns` directly would throw `TypeError: ... .some is not a
 * function` deep inside the import pipeline instead.
 */
function protocolNodePatterns(rule: ProtocolMapRule): string[] {
  const patterns: unknown = rule.nodePatterns;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

export interface PlatformDefinition {
  id: string;
  label: string;
  format: 'json' | 'yaml';
  nodeTypeMap: NodeTypeMapping[];
  credentialConsolidation: CredentialConsolidationRule[];
  nodeRoleClassification: NodeRolePattern[];
  excludedCredentialTypes: string[];
  protocolMapRules: ProtocolMapRule[];
  isBuiltin: boolean;
}

// -- Service map helper -----------------------------------------

/**
 * Node-type mappings ordered longest-pattern-first.
 *
 * Matching walks the list in order and takes the first hit, so declaration
 * order silently decided the winner when one pattern is a prefix/substring of
 * another — Make declares `google` before `google-sheets`, which made every
 * `google-sheets:*` and `google-drive:*` module resolve to the generic
 * `google` service and left those mappings unreachable. Sorting by pattern
 * length makes the most specific mapping win regardless of authoring order.
 */
const _sortedMappings = new WeakMap<PlatformDefinition, NodeTypeMapping[]>();

function mappingsBySpecificity(def: PlatformDefinition): NodeTypeMapping[] {
  const cached = _sortedMappings.get(def);
  if (cached) return cached;
  const sorted = [...def.nodeTypeMap].sort(
    (a, b) => b.sourcePattern.length - a.sourcePattern.length,
  );
  _sortedMappings.set(def, sorted);
  return sorted;
}

/**
 * Resolve an already-normalized identifier (lowercased, punctuation-stripped)
 * to its target service by substring match, most specific mapping first.
 * Returns undefined when no mapping applies so the caller can pick its own
 * fallback.
 */
export function resolveServiceByInclusion(
  def: PlatformDefinition,
  candidate: string,
): string | undefined {
  for (const mapping of mappingsBySpecificity(def)) {
    if (candidate.includes(mapping.sourcePattern)) return mapping.targetService;
  }
  return undefined;
}

/** Resolve a node type string to its target service using a PlatformDefinition. */
export function resolveNodeType(def: PlatformDefinition, nodeType: string): string {
  const lower = nodeType.toLowerCase();
  // Strip platform prefix (e.g., "n8n-nodes-base.gmailTrigger" -> "gmailtrigger")
  const parts = lower.split('.');
  const name = parts[parts.length - 1] || lower;
  // Remove common suffixes
  const cleaned = name.replace(/trigger$/, '').replace(/node$/, '');

  for (const mapping of mappingsBySpecificity(def)) {
    if (cleaned.startsWith(mapping.sourcePattern) || cleaned === mapping.sourcePattern) {
      return mapping.targetService;
    }
  }
  return cleaned;
}

/**
 * Classify a node's role using platform-specific patterns.
 *
 * Patterns are substring tests by default. A trailing `$` anchors the pattern
 * to the END of the node type — the table authors three of them (`if$`, `set$`,
 * `code$`) precisely because the unanchored forms are too greedy to be safe
 * (`if` alone matches `notification`, `set` matches `dataset`). Those anchors
 * were previously fed to `includes()`, which searches for a LITERAL `$`; no node
 * type contains one, so all three rows were dead and their `decision` / `utility`
 * classifications could never be produced. Only the `=== 'trigger'` branch is
 * read today, which is why nothing failed — but the table advertised a
 * classification it could not perform.
 */
export function classifyNodeRole(def: PlatformDefinition, nodeType: string): string {
  const lower = nodeType.toLowerCase();
  for (const nrp of def.nodeRoleClassification) {
    const pattern = nrp.pattern.toLowerCase();
    const anchored = pattern.endsWith('$');
    const needle = anchored ? pattern.slice(0, -1) : pattern;
    if (!needle) continue;
    if (anchored ? lower.endsWith(needle) : lower.includes(needle)) {
      return nrp.role;
    }
  }
  return 'tool';
}

const PROTOCOL_LABELS: Record<ProtocolMapRule['targetProtocol'], string> = {
  manual_review: 'Manual Review',
  user_message: 'User Notifications',
  agent_memory: 'Agent Memory',
  emit_event: 'Event Emission',
};

/**
 * Detect protocol capabilities from a list of workflow node types.
 *
 * Matches each node type against the platform's protocolMapRules.nodePatterns
 * and returns deduplicated capabilities.  This is the primary (structured)
 * detection layer; keyword-based prompt scanning is the fallback.
 */
export function extractProtocolsFromNodes(
  def: PlatformDefinition,
  nodeTypes: string[],
): { type: ProtocolMapRule['targetProtocol']; label: string; context: string }[] {
  const seen = new Set<string>();
  const result: { type: ProtocolMapRule['targetProtocol']; label: string; context: string }[] = [];

  for (const nodeType of nodeTypes) {
    const lower = nodeType.toLowerCase();
    for (const rule of def.protocolMapRules ?? []) {
      if (seen.has(rule.targetProtocol)) continue;
      if (protocolNodePatterns(rule).some((p) => lower.includes(p.toLowerCase()))) {
        seen.add(rule.targetProtocol);
        result.push({
          type: rule.targetProtocol,
          label: PROTOCOL_LABELS[rule.targetProtocol],
          context: rule.condition,
        });
      }
    }
  }

  return result;
}

// -- Built-in definitions ----------------------------------------

export const N8N_DEFINITION: PlatformDefinition = {
  id: 'n8n',
  label: 'n8n',
  format: 'json',
  nodeTypeMap: [
    { sourcePattern: 'gmail', targetService: 'gmail' },
    { sourcePattern: 'slack', targetService: 'slack' },
    { sourcePattern: 'github', targetService: 'github' },
    { sourcePattern: 'postgres', targetService: 'postgres' },
    { sourcePattern: 'notion', targetService: 'notion' },
    { sourcePattern: 'webhook', targetService: 'webhook' },
    { sourcePattern: 'cron', targetService: 'schedule' },
    { sourcePattern: 'schedule', targetService: 'schedule' },
    { sourcePattern: 'httprequest', targetService: 'http' },
    { sourcePattern: 'airtable', targetService: 'airtable' },
    { sourcePattern: 'googlesheets', targetService: 'google-sheets' },
    { sourcePattern: 'googledrive', targetService: 'google-drive' },
    { sourcePattern: 'googlecalendar', targetService: 'google-calendar' },
    { sourcePattern: 'discord', targetService: 'discord' },
    { sourcePattern: 'jira', targetService: 'jira' },
    { sourcePattern: 'telegram', targetService: 'telegram' },
    { sourcePattern: 'twitter', targetService: 'twitter' },
    { sourcePattern: 'dropbox', targetService: 'dropbox' },
    { sourcePattern: 'mongodb', targetService: 'mongodb' },
    { sourcePattern: 'mysql', targetService: 'mysql' },
    { sourcePattern: 'redis', targetService: 'redis' },
    { sourcePattern: 's3', targetService: 'aws-s3' },
    { sourcePattern: 'sqs', targetService: 'aws-sqs' },
    { sourcePattern: 'stripe', targetService: 'stripe' },
    { sourcePattern: 'twilio', targetService: 'twilio' },
    { sourcePattern: 'sendgrid', targetService: 'sendgrid' },
    { sourcePattern: 'openai', targetService: 'openai' },
    { sourcePattern: 'hubspot', targetService: 'hubspot' },
    { sourcePattern: 'clickup', targetService: 'clickup' },
    { sourcePattern: 'asana', targetService: 'asana' },
    { sourcePattern: 'todoist', targetService: 'todoist' },
    { sourcePattern: 'linear', targetService: 'linear' },
    { sourcePattern: 'salesforce', targetService: 'salesforce' },
    { sourcePattern: 'zendesk', targetService: 'zendesk' },
    { sourcePattern: 'intercom', targetService: 'intercom' },
    { sourcePattern: 'mailchimp', targetService: 'mailchimp' },
    { sourcePattern: 'microsoftoutlook', targetService: 'microsoft' },
    { sourcePattern: 'microsoftonedrive', targetService: 'microsoft' },
    { sourcePattern: 'microsoftteams', targetService: 'microsoft' },
  ],
  credentialConsolidation: [
    {
      sourcePatterns: ['gmailOAuth2', 'googleSheetsOAuth2Api', 'googleCalendarOAuth2Api', 'googleDriveOAuth2Api', 'google*'],
      targetConnector: 'google',
      description: "All Google OAuth credential types -> single 'google' connector",
    },
    {
      sourcePatterns: ['slackOAuth2Api', 'slackApi'],
      targetConnector: 'slack',
      description: "All Slack credential types -> single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoftOutlookOAuth2Api', 'microsoftOneDriveOAuth2Api', 'microsoftTeamsOAuth2Api'],
      targetConnector: 'microsoft',
      description: "All Microsoft credential types -> single 'microsoft' connector",
    },
  ],
  nodeRoleClassification: [
    { pattern: 'trigger', role: 'trigger' },
    { pattern: 'cron', role: 'trigger' },
    { pattern: 'schedule', role: 'trigger' },
    { pattern: 'webhook', role: 'trigger' },
    { pattern: 'aiagent', role: 'llm' },
    { pattern: 'llmchat', role: 'llm' },
    { pattern: 'chatmodel', role: 'llm' },
    { pattern: 'outputparser', role: 'llm' },
    { pattern: 'openai', role: 'llm' },
    { pattern: 'anthropic', role: 'llm' },
    { pattern: 'if$', role: 'decision' },
    { pattern: 'switch', role: 'decision' },
    { pattern: 'filter', role: 'decision' },
    { pattern: 'merge', role: 'utility' },
    { pattern: 'set$', role: 'utility' },
    { pattern: 'splitinbatches', role: 'utility' },
    { pattern: 'function', role: 'utility' },
    { pattern: 'code$', role: 'utility' },
  ],
  excludedCredentialTypes: ['anthropicApi', 'openAiApi'],
  protocolMapRules: [
    { platformPattern: 'Wait node, Approval node', targetProtocol: 'manual_review', condition: 'Node pauses for human confirmation', nodePatterns: ['wait', 'form', 'approval'] },
    { platformPattern: 'Set variable, store data, extract information', targetProtocol: 'agent_memory', condition: 'Node captures or stores data', nodePatterns: ['set', 'spreadsheetfile', 'redis', 'postgres', 'mongodb', 'mysql'] },
    { platformPattern: 'Webhook output, Execute Workflow', targetProtocol: 'emit_event', condition: 'Node triggers downstream workflows', nodePatterns: ['executeworkflow'] },
    { platformPattern: 'Notification node, alert node', targetProtocol: 'user_message', condition: 'Node sends notifications', nodePatterns: ['sendemail', 'slack', 'telegram', 'discord', 'twilio'] },
  ],
  isBuiltin: true,
};

export const ZAPIER_DEFINITION: PlatformDefinition = {
  id: 'zapier',
  label: 'Zapier',
  format: 'json',
  nodeTypeMap: [
    { sourcePattern: 'gmail', targetService: 'gmail' },
    { sourcePattern: 'google-mail', targetService: 'gmail' },
    { sourcePattern: 'slack', targetService: 'slack' },
    { sourcePattern: 'github', targetService: 'github' },
    { sourcePattern: 'google-sheets', targetService: 'google-sheets' },
    { sourcePattern: 'google-drive', targetService: 'google-drive' },
    { sourcePattern: 'trello', targetService: 'trello' },
    { sourcePattern: 'asana', targetService: 'asana' },
    { sourcePattern: 'notion', targetService: 'notion' },
    { sourcePattern: 'airtable', targetService: 'airtable' },
    { sourcePattern: 'discord', targetService: 'discord' },
    { sourcePattern: 'jira', targetService: 'jira' },
    { sourcePattern: 'hubspot', targetService: 'hubspot' },
    { sourcePattern: 'mailchimp', targetService: 'mailchimp' },
    { sourcePattern: 'stripe', targetService: 'stripe' },
    { sourcePattern: 'twilio', targetService: 'twilio' },
    { sourcePattern: 'twitter', targetService: 'twitter' },
    { sourcePattern: 'dropbox', targetService: 'dropbox' },
    { sourcePattern: 'webhook', targetService: 'webhook' },
    { sourcePattern: 'schedule', targetService: 'schedule' },
    { sourcePattern: 'formatter', targetService: 'formatter' },
    { sourcePattern: 'filter', targetService: 'filter' },
    { sourcePattern: 'code', targetService: 'code' },
    { sourcePattern: 'salesforce', targetService: 'salesforce' },
    { sourcePattern: 'zendesk', targetService: 'zendesk' },
    { sourcePattern: 'intercom', targetService: 'intercom' },
    { sourcePattern: 'todoist', targetService: 'todoist' },
    { sourcePattern: 'clickup', targetService: 'clickup' },
    { sourcePattern: 'linear', targetService: 'linear' },
  ],
  credentialConsolidation: [
    {
      sourcePatterns: ['gmail', 'google-mail', 'google-sheets', 'google-drive', 'google-calendar', 'google-contacts', 'google*'],
      targetConnector: 'google',
      description: "All Zapier Google app types -> single 'google' connector",
    },
    {
      sourcePatterns: ['slack', 'slack-*'],
      targetConnector: 'slack',
      description: "All Zapier Slack app types -> single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoft-outlook', 'microsoft-onedrive', 'microsoft-teams', 'microsoft-*'],
      targetConnector: 'microsoft',
      description: "All Zapier Microsoft app types -> single 'microsoft' connector",
    },
  ],
  nodeRoleClassification: [
    { pattern: 'trigger', role: 'trigger' },
    { pattern: 'schedule', role: 'trigger' },
    { pattern: 'webhook', role: 'trigger' },
    { pattern: 'formatter', role: 'utility' },
    { pattern: 'filter', role: 'decision' },
    { pattern: 'code', role: 'utility' },
    { pattern: 'paths', role: 'decision' },
    { pattern: 'delay', role: 'utility' },
  ],
  excludedCredentialTypes: ['openai', 'chatgpt'],
  protocolMapRules: [
    { platformPattern: 'Delay step, approval step', targetProtocol: 'manual_review', condition: 'Step pauses for human confirmation', nodePatterns: ['delay', 'approval'] },
    { platformPattern: 'Formatter, lookup, search', targetProtocol: 'agent_memory', condition: 'Step processes or extracts data', nodePatterns: ['formatter', 'storage', 'lookup', 'digest'] },
    { platformPattern: 'Webhook output, trigger Zap', targetProtocol: 'emit_event', condition: 'Step triggers downstream Zaps', nodePatterns: ['webhook'] },
    { platformPattern: 'Email notification, SMS alert', targetProtocol: 'user_message', condition: 'Step sends notifications', nodePatterns: ['gmail', 'slack', 'email', 'sms', 'twilio'] },
  ],
  isBuiltin: true,
};

export const MAKE_DEFINITION: PlatformDefinition = {
  id: 'make',
  label: 'Make (Integromat)',
  format: 'json',
  nodeTypeMap: [
    { sourcePattern: 'google', targetService: 'google' },
    { sourcePattern: 'gmail', targetService: 'gmail' },
    { sourcePattern: 'google-sheets', targetService: 'google-sheets' },
    { sourcePattern: 'google-drive', targetService: 'google-drive' },
    { sourcePattern: 'slack', targetService: 'slack' },
    { sourcePattern: 'github', targetService: 'github' },
    { sourcePattern: 'notion', targetService: 'notion' },
    { sourcePattern: 'airtable', targetService: 'airtable' },
    { sourcePattern: 'discord', targetService: 'discord' },
    { sourcePattern: 'jira', targetService: 'jira' },
    { sourcePattern: 'hubspot', targetService: 'hubspot' },
    { sourcePattern: 'mailchimp', targetService: 'mailchimp' },
    { sourcePattern: 'stripe', targetService: 'stripe' },
    { sourcePattern: 'twilio', targetService: 'twilio' },
    { sourcePattern: 'twitter', targetService: 'twitter' },
    { sourcePattern: 'dropbox', targetService: 'dropbox' },
    { sourcePattern: 'http', targetService: 'http' },
    { sourcePattern: 'webhook', targetService: 'webhook' },
    { sourcePattern: 'json', targetService: 'json' },
    { sourcePattern: 'csv', targetService: 'csv' },
    { sourcePattern: 'email', targetService: 'email' },
    { sourcePattern: 'ftp', targetService: 'ftp' },
    { sourcePattern: 'mysql', targetService: 'mysql' },
    { sourcePattern: 'postgres', targetService: 'postgres' },
    { sourcePattern: 'mongodb', targetService: 'mongodb' },
    { sourcePattern: 'salesforce', targetService: 'salesforce' },
  ],
  credentialConsolidation: [
    {
      sourcePatterns: ['google:*', 'gmail:*', 'google-sheets:*', 'google-drive:*'],
      targetConnector: 'google',
      description: "All Make Google module types -> single 'google' connector",
    },
    {
      sourcePatterns: ['slack:*'],
      targetConnector: 'slack',
      description: "All Make Slack module types -> single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoft-*:*'],
      targetConnector: 'microsoft',
      description: "All Make Microsoft module types -> single 'microsoft' connector",
    },
  ],
  nodeRoleClassification: [
    { pattern: 'trigger', role: 'trigger' },
    { pattern: 'watch', role: 'trigger' },
    { pattern: 'webhook', role: 'trigger' },
    { pattern: 'instant', role: 'trigger' },
    { pattern: 'router', role: 'decision' },
    { pattern: 'filter', role: 'decision' },
    { pattern: 'json', role: 'utility' },
    { pattern: 'csv', role: 'utility' },
    { pattern: 'builtin:router', role: 'decision' },
  ],
  excludedCredentialTypes: ['openai:*'],
  protocolMapRules: [
    { platformPattern: 'Sleep, approval modules', targetProtocol: 'manual_review', condition: 'Module pauses for human confirmation', nodePatterns: ['sleep', 'approval'] },
    { platformPattern: 'Module reads, searches, transforms', targetProtocol: 'agent_memory', condition: 'Module processes or extracts data', nodePatterns: ['setvar', 'datastore', 'json', 'csv', 'aggregate'] },
    { platformPattern: 'Webhook output, trigger scenario', targetProtocol: 'emit_event', condition: 'Module triggers downstream scenarios', nodePatterns: ['webhook', 'http'] },
    { platformPattern: 'Email, Slack, notification modules', targetProtocol: 'user_message', condition: 'Module sends notifications', nodePatterns: ['email', 'slack', 'telegram', 'sms'] },
  ],
  isBuiltin: true,
};

