/**
 * Pure function: map a ManualReviewItem + resolved persona summary into a
 * UnifiedInboxItem of kind 'approval'. No store access, no side effects.
 */
import type { ManualReviewItem } from '@/lib/types/types';
import { normalizeSeverity, type UnifiedInboxItem } from '../../types';

interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}

export function adaptApproval(
  review: ManualReviewItem,
  persona: PersonaSummary,
): Extract<UnifiedInboxItem, { kind: 'approval' }> {
  return {
    id: `approval:${review.id}`,
    kind: 'approval',
    source: review.id,
    personaId: review.persona_id,
    personaName: persona.personaName,
    personaIcon: persona.personaIcon,
    personaColor: persona.personaColor,
    createdAt: review.created_at,
    severity: normalizeSeverity(review.severity),
    title: review.title,
    body: review.content,
    data: {
      executionId: review.execution_id,
      reviewType: review.review_type,
      contextData: review.context_data,
      suggestedActions: review.suggested_actions,
      reviewerNotes: review.reviewer_notes,
      origin: review.source ?? 'local',
    },
  };
}
