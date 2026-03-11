// ============================================================================
// Wizard Instruction Compiler & Summary Helper
// ============================================================================

import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';
import type { WizardAnswers } from './wizardSteps';

type InstructionEntry =
  | { type: 'single'; map: Record<string, string>; fallback: string }
  | { type: 'multi'; map: Record<string, string>; prefix: string };

const ANSWER_TO_INSTRUCTION: Record<string, InstructionEntry> = {
  mission_type: {
    type: 'single',
    fallback: 'Create an agent with this mission:',
    map: {
      'Inbox / Feed Monitor': 'Create an agent that monitors incoming data streams, triages and categorizes items by importance, and surfaces what requires attention.',
      'Data Processor & Router': 'Create an agent that processes incoming data, extracts key information, transforms it as needed, and routes it to the appropriate downstream systems.',
      'Full Lifecycle Manager': 'Create a full lifecycle management agent that handles end-to-end processing: monitoring, extraction, action creation, follow-up tracking, and comprehensive reporting.',
      'Notification & Alert Hub': 'Create an agent that monitors conditions and thresholds, detects important events, and sends targeted alerts and notifications to the right people.',
    },
  },
  data_scope: {
    type: 'single',
    fallback: 'Data scope:',
    map: {
      'All incoming data': 'It should process all incoming data without filtering.',
      'Specific sources (allowlist)': 'It should only process data from an explicitly configured allowlist of sources, senders, or domains. Include a configurable sender allowlist section in the prompt.',
      'Filter / label-based': 'It should only process data that matches specific filters, labels, or tags. Include configuration for filter rules.',
      'Custom rules': 'It should use custom rules to decide what to process, based on content analysis, keyword matching, or conditional logic.',
    },
  },
  data_actions: {
    type: 'multi',
    prefix: 'When processing data, the agent should:',
    map: {
      'Create tasks in a project tool': 'create tasks in a project management tool with title, description, priority, and due date extracted from the source data',
      'Send notifications': 'send notifications and alerts via messaging channels when conditions are met',
      'Update spreadsheets or databases': 'update spreadsheets or databases with extracted data for tracking and analysis',
      'Draft responses for review': 'draft response templates for human review before sending',
    },
  },
  autonomy_level: {
    type: 'single',
    fallback: 'Autonomy level:',
    map: {
      'Read-only + report': 'The agent should be read-only â€” it can analyze and report findings but never modify or create anything externally.',
      'Read + organize': 'The agent can read, label, categorize, and organize data, but cannot send messages or create external records.',
      'Full access with approval gates': 'The agent should have full access to its connected services but must pause for human approval before sending outbound messages or taking any destructive actions.',
      'Full autonomous': 'The agent should operate fully autonomously without requiring approval for any actions.',
    },
  },
  approval_actions: {
    type: 'multi',
    prefix: 'Specifically, require human approval for:',
    map: {},
  },
  trigger_type: {
    type: 'single',
    fallback: 'Trigger:',
    map: {
      'Real-time (webhook / push)': 'Use a real-time webhook or push notification trigger for instant processing when new data arrives.',
      'Scheduled (cron)': 'Use a scheduled cron trigger to run at fixed intervals (suggest an appropriate schedule based on the use case).',
      'Polling interval': 'Use a polling trigger to check for new data at regular intervals.',
      'Manual only': 'Use a manual trigger â€” the agent only runs when explicitly invoked by the user.',
    },
  },
  reporting_style: {
    type: 'single',
    fallback: 'Reporting:',
    map: {
      'Silent (log only)': 'The agent should operate silently, logging activity for review but not sending proactive notifications.',
      'Daily digest': 'The agent should generate a daily digest summarizing all activity: items processed, actions taken, items needing attention, and any errors.',
      'Per-run summary': 'The agent should send a brief summary notification after each processing run.',
      'Real-time notifications': 'The agent should send real-time notifications for every significant action taken.',
    },
  },
};

export function compileWizardInstruction(answers: WizardAnswers): string {
  const parts: string[] = [];

  for (const [key, entry] of Object.entries(ANSWER_TO_INSTRUCTION)) {
    const value = answers[key];
    if (!value) continue;

    if (entry.type === 'single' && typeof value === 'string') {
      parts.push(entry.map[value] || `${entry.fallback} ${value}`);
    } else if (entry.type === 'multi' && Array.isArray(value) && value.length > 0) {
      const mapped = value.map((v) => entry.map[v] || v.toLowerCase());
      parts.push(`${entry.prefix} ${mapped.join('; ')}.`);
    }
  }

  const additional = answers['additional_context'];
  if (additional && typeof additional === 'string' && additional.trim()) {
    parts.push(`\nAdditional context and requirements:\n${additional.trim()}`);
  }

  return parts.join('\n\n');
}

// â”€â”€ Wizard â†’ AgentIR Compilation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Produces a structured AgentIR directly from wizard answers,
// enabling the path: wizard answers â†’ AgentIR â†’ apply(AgentIR).

const TRIGGER_TYPE_MAP: Record<string, SuggestedTrigger['trigger_type']> = {
  'Real-time (webhook / push)': 'webhook',
  'Scheduled (cron)': 'schedule',
  'Polling interval': 'polling',
  'Manual only': 'manual',
};

const TOOL_MAP: Record<string, string[]> = {
  'Create tasks in a project tool': ['task_create', 'project_management'],
  'Send notifications': ['send_notification', 'messaging'],
  'Update spreadsheets or databases': ['spreadsheet_update', 'database_write'],
  'Draft responses for review': ['draft_response', 'manual_review'],
};

/**
 * Compile wizard answers directly into an AgentIR structure.
 *
 * This produces a complete (though minimal) AgentIR that can be:
 * - Applied directly to a persona via apply(AgentIR)
 * - Passed to the LLM for enrichment
 * - Diffed/merged with other AgentIR instances
 * - Stored as a template payload
 */
export function compileWizardToAgentIR(answers: WizardAnswers): AgentIR {
  const instruction = compileWizardInstruction(answers);
  const mission = (answers['mission_type'] as string) || 'Custom Agent';
  const autonomy = (answers['autonomy_level'] as string) || '';
  const dataScope = (answers['data_scope'] as string) || '';
  const reporting = (answers['reporting_style'] as string) || '';
  const triggerChoice = (answers['trigger_type'] as string) || '';
  const dataActions = (Array.isArray(answers['data_actions']) ? answers['data_actions'] : []) as string[];
  const approvalActions = (Array.isArray(answers['approval_actions']) ? answers['approval_actions'] : []) as string[];

  // Build identity from mission type
  const dataEntry = ANSWER_TO_INSTRUCTION.data_scope;
  const identity = `You are a ${mission} agent.${dataScope && dataEntry ? ` ${dataEntry.map[dataScope] || ''}` : ''}`;

  // Build instructions from autonomy + reporting
  const instructionParts: string[] = [];
  const autonomyEntry = ANSWER_TO_INSTRUCTION.autonomy_level;
  const reportingEntry = ANSWER_TO_INSTRUCTION.reporting_style;
  if (autonomy && autonomyEntry) instructionParts.push(autonomyEntry.map[autonomy] || '');
  if (reporting && reportingEntry) instructionParts.push(reportingEntry.map[reporting] || '');
  if (approvalActions.length > 0) {
    instructionParts.push(`Require human approval for: ${approvalActions.join('; ')}.`);
  }
  const instructions = instructionParts.filter(Boolean).join('\n\n');

  // Derive tools from data actions
  const tools: string[] = [];
  for (const action of dataActions) {
    const mapped = TOOL_MAP[action];
    if (mapped) tools.push(...mapped);
  }

  // Build trigger from trigger type selection
  const triggers: SuggestedTrigger[] = [];
  if (triggerChoice) {
    const triggerType = TRIGGER_TYPE_MAP[triggerChoice] || 'manual';
    triggers.push({
      trigger_type: triggerType,
      config: triggerType === 'schedule' ? { cron: '0 9 * * *' } : {},
      description: ANSWER_TO_INSTRUCTION.trigger_type?.map[triggerChoice] ?? triggerChoice,
    });
  }

  // Build summary
  const summaryParts = getAnswerSummary(answers);
  const summary = summaryParts.map((s) => `${s.label}: ${s.value}`).join(' | ');

  return {
    structured_prompt: {
      identity,
      instructions,
      toolGuidance: tools.length > 0 ? `Available tools: ${tools.join(', ')}` : '',
      examples: '',
      errorHandling: 'Log errors and continue processing remaining items. Report failures in the run summary.',
      customSections: [],
    },
    suggested_tools: tools,
    suggested_triggers: triggers,
    full_prompt_markdown: instruction,
    summary: summary || `${mission} agent`,
    design_highlights: [
      {
        category: 'Mission',
        icon: 'ðŸŽ¯',
        color: 'violet',
        items: [mission],
        section: 'identity',
      },
    ],
  };
}

// â”€â”€ Summary Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function getAnswerSummary(answers: WizardAnswers): Array<{ label: string; value: string }> {
  const summary: Array<{ label: string; value: string }> = [];

  const mission = answers['mission_type'];
  if (mission) summary.push({ label: 'Mission', value: mission as string });

  const scope = answers['data_scope'];
  if (scope) summary.push({ label: 'Data Scope', value: scope as string });

  const actions = answers['data_actions'];
  if (Array.isArray(actions) && actions.length > 0) {
    summary.push({ label: 'Actions', value: actions.join(', ') });
  }

  const autonomy = answers['autonomy_level'];
  if (autonomy) summary.push({ label: 'Autonomy', value: autonomy as string });

  const approvals = answers['approval_actions'];
  if (Array.isArray(approvals) && approvals.length > 0) {
    summary.push({ label: 'Approval Gates', value: approvals.join(', ') });
  }

  const trigger = answers['trigger_type'];
  if (trigger) summary.push({ label: 'Trigger', value: trigger as string });

  const reporting = answers['reporting_style'];
  if (reporting) summary.push({ label: 'Reporting', value: reporting as string });

  return summary;
}
