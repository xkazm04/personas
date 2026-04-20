/**
 * Pure function: map a PersonaHealingIssue + resolved persona summary into a
 * UnifiedInboxItem of kind 'health'. No store access, no side effects.
 */
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { normalizeSeverity, type UnifiedInboxItem } from '../../types';

interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}

export function adaptHealing(
  issue: PersonaHealingIssue,
  persona: PersonaSummary,
): Extract<UnifiedInboxItem, { kind: 'health' }> {
  return {
    id: `health:${issue.id}`,
    kind: 'health',
    source: issue.id,
    personaId: issue.persona_id,
    personaName: persona.personaName,
    personaIcon: persona.personaIcon,
    personaColor: persona.personaColor,
    createdAt: issue.created_at,
    severity: normalizeSeverity(issue.severity),
    title: issue.title,
    body: issue.description,
    data: {
      executionId: issue.execution_id,
      category: issue.category,
      suggestedFix: issue.suggested_fix,
      isCircuitBreaker: issue.is_circuit_breaker,
    },
  };
}
