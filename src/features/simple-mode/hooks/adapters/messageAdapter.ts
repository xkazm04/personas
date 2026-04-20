/**
 * Pure function: map a PersonaMessage + resolved persona summary into a
 * UnifiedInboxItem of kind 'message'. Messages have no severity field, so
 * we derive one from `priority` (high -> warning, everything else -> info).
 */
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import { type Severity, type UnifiedInboxItem } from '../../types';

interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}

function priorityToSeverity(priority: string): Severity {
  const p = priority.toLowerCase();
  if (p === 'high') return 'warning';
  return 'info';
}

export function adaptMessage(
  msg: PersonaMessage,
  persona: PersonaSummary,
): Extract<UnifiedInboxItem, { kind: 'message' }> {
  return {
    id: `message:${msg.id}`,
    kind: 'message',
    source: msg.id,
    personaId: msg.persona_id,
    personaName: persona.personaName,
    personaIcon: persona.personaIcon,
    personaColor: persona.personaColor,
    createdAt: msg.created_at,
    severity: priorityToSeverity(msg.priority),
    title: msg.title ?? `${persona.personaName} sent you a message`,
    body: msg.content,
    data: {
      executionId: msg.execution_id,
      contentType: msg.content_type,
      priority: msg.priority,
      threadId: msg.thread_id,
      metadata: msg.metadata,
    },
  };
}
