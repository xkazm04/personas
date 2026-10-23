import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';

/**
 * Counts for the expanded gallery row. `null` means the template's
 * design_result does not carry that dimension at all, so the row must not
 * claim a zero for it.
 *
 * Seeded catalog templates store their raw v3 payload as design_result
 * (seedTemplates.ts): `persona` + `use_cases` (mostly `recipe_ref` pointers),
 * with notification channels under `persona.notification_channels_default`.
 * Only AI-designed reviews carry the flat AgentIR arrays
 * (suggested_event_subscriptions, protocol_capabilities, ...).
 */
export interface ExpandedRowStats {
  flowCount: number;
  useCases: number;
  events: number | null;
  reviews: number | null;
  notifications: number | null;
}

const lengthOf = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);

export function deriveExpandedRowStats(
  review: PersonaDesignReview,
  designResult: AgentIR | null,
): ExpandedRowStats {
  // design_result is parsed JSON whose shape the seed decides, not AgentIR:
  // read it as a plain record and check each field's shape before counting.
  const raw: Record<string, unknown> = designResult ? { ...designResult } : {};

  const fromReview = parseJsonOrDefault<unknown[]>(review.use_case_flows, []);
  const flowCount = fromReview.length > 0 ? fromReview.length : (lengthOf(raw.use_case_flows) ?? 0);

  const declaredUseCases = lengthOf(raw.use_cases) ?? 0;
  const useCases = declaredUseCases > 0 ? declaredUseCases : flowCount;

  const protocols = Array.isArray(raw.protocol_capabilities)
    ? (raw.protocol_capabilities as Array<{ type?: unknown }>)
    : null;
  const reviews = protocols ? protocols.filter((p) => p?.type === 'manual_review').length : null;

  const persona = raw.persona && typeof raw.persona === 'object' ? (raw.persona as Record<string, unknown>) : null;
  const notificationSources = [
    lengthOf(raw.suggested_notification_channels),
    protocols ? protocols.filter((p) => p?.type === 'user_message').length : null,
    lengthOf(persona?.notification_channels_default),
  ].filter((n): n is number => n !== null);
  const notifications = notificationSources.length > 0
    ? notificationSources.reduce((a, b) => a + b, 0)
    : null;

  return {
    flowCount,
    useCases,
    events: lengthOf(raw.suggested_event_subscriptions),
    reviews,
    notifications,
  };
}
