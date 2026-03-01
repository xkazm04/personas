/**
 * Config-driven platform definitions for workflow import.
 *
 * Mirrors the Rust PlatformDefinition struct. Each platform's node-type
 * mappings, credential consolidation rules, and role classifications are
 * defined here as data rather than scattered across individual parsers.
 */

// ── Types ──────────────────────────────────────────────────────

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
  platformPattern: string;
  targetProtocol: 'user_message' | 'agent_memory' | 'manual_review' | 'emit_event';
  condition: string;
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

// ── Service map helper ─────────────────────────────────────────

/** Convert a PlatformDefinition's nodeTypeMap into a flat Record for backward-compat usage. */
export function toServiceMap(def: PlatformDefinition): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of def.nodeTypeMap) {
    map[m.sourcePattern] = m.targetService;
  }
  return map;
}

/** Resolve a node type string to its target service using a PlatformDefinition. */
export function resolveNodeType(def: PlatformDefinition, nodeType: string): string {
  const lower = nodeType.toLowerCase();
  // Strip platform prefix (e.g., "n8n-nodes-base.gmailTrigger" → "gmailtrigger")
  const parts = lower.split('.');
  const name = parts[parts.length - 1] || lower;
  // Remove common suffixes
  const cleaned = name.replace(/trigger$/, '').replace(/node$/, '');

  for (const mapping of def.nodeTypeMap) {
    if (cleaned.startsWith(mapping.sourcePattern) || cleaned === mapping.sourcePattern) {
      return mapping.targetService;
    }
  }
  return cleaned;
}

/** Classify a node's role using platform-specific patterns. */
export function classifyNodeRole(def: PlatformDefinition, nodeType: string): string {
  const lower = nodeType.toLowerCase();
  for (const nrp of def.nodeRoleClassification) {
    if (lower.includes(nrp.pattern.toLowerCase())) {
      return nrp.role;
    }
  }
  return 'tool';
}

// ── Built-in definitions ────────────────────────────────────────

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
      description: "All Google OAuth credential types → single 'google' connector",
    },
    {
      sourcePatterns: ['slackOAuth2Api', 'slackApi'],
      targetConnector: 'slack',
      description: "All Slack credential types → single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoftOutlookOAuth2Api', 'microsoftOneDriveOAuth2Api', 'microsoftTeamsOAuth2Api'],
      targetConnector: 'microsoft',
      description: "All Microsoft credential types → single 'microsoft' connector",
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
    { platformPattern: 'Send email, post to Slack, modify database', targetProtocol: 'manual_review', condition: 'Node performs external side-effects' },
    { platformPattern: 'Set variable, store data, extract information', targetProtocol: 'agent_memory', condition: 'Node captures or stores data' },
    { platformPattern: 'Wait node, Approval node', targetProtocol: 'manual_review', condition: 'Node pauses for human confirmation' },
    { platformPattern: 'Webhook output, Execute Workflow', targetProtocol: 'emit_event', condition: 'Node triggers downstream workflows' },
    { platformPattern: 'Notification node, alert node', targetProtocol: 'user_message', condition: 'Node sends notifications' },
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
      description: "All Zapier Google app types → single 'google' connector",
    },
    {
      sourcePatterns: ['slack', 'slack-*'],
      targetConnector: 'slack',
      description: "All Zapier Slack app types → single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoft-outlook', 'microsoft-onedrive', 'microsoft-teams', 'microsoft-*'],
      targetConnector: 'microsoft',
      description: "All Zapier Microsoft app types → single 'microsoft' connector",
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
    { platformPattern: 'Send email, post message', targetProtocol: 'manual_review', condition: 'Step performs external side-effects' },
    { platformPattern: 'Formatter, lookup, search', targetProtocol: 'agent_memory', condition: 'Step processes or extracts data' },
    { platformPattern: 'Delay step, approval step', targetProtocol: 'manual_review', condition: 'Step pauses for human confirmation' },
    { platformPattern: 'Webhook output, trigger Zap', targetProtocol: 'emit_event', condition: 'Step triggers downstream Zaps' },
    { platformPattern: 'Email notification, SMS alert', targetProtocol: 'user_message', condition: 'Step sends notifications' },
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
      description: "All Make Google module types → single 'google' connector",
    },
    {
      sourcePatterns: ['slack:*'],
      targetConnector: 'slack',
      description: "All Make Slack module types → single 'slack' connector",
    },
    {
      sourcePatterns: ['microsoft-*:*'],
      targetConnector: 'microsoft',
      description: "All Make Microsoft module types → single 'microsoft' connector",
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
    { platformPattern: 'Module creates, updates, or sends', targetProtocol: 'manual_review', condition: 'Module performs external side-effects' },
    { platformPattern: 'Module reads, searches, transforms', targetProtocol: 'agent_memory', condition: 'Module processes or extracts data' },
    { platformPattern: 'Webhook output, trigger scenario', targetProtocol: 'emit_event', condition: 'Module triggers downstream scenarios' },
    { platformPattern: 'Email, Slack, notification modules', targetProtocol: 'user_message', condition: 'Module sends notifications' },
  ],
  isBuiltin: true,
};

/** All built-in platform definitions. */
export const BUILTIN_DEFINITIONS: PlatformDefinition[] = [
  N8N_DEFINITION,
  ZAPIER_DEFINITION,
  MAKE_DEFINITION,
];

/** Look up a built-in definition by platform ID. */
export function getBuiltinDefinition(platformId: string): PlatformDefinition | undefined {
  return BUILTIN_DEFINITIONS.find((d) => d.id === platformId);
}
