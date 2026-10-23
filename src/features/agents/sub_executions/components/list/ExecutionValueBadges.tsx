import { BusinessOutcomeBadge } from '@/features/shared/components/display/BusinessOutcomeBadge';

interface ExecutionValueBadgesProps {
  businessOutcome?: string | null;
}

/**
 * Compact value-verdict badge for an execution row: the business outcome (did
 * the run deliver real work), as the Overview activity feed presents it.
 *
 * It also accepted `directorScore` and `thinkingLevel` and drew a star rating
 * and a reasoning-effort chip for them. Its one caller (`useExecutionColumns`)
 * only ever passed `businessOutcome`, because the summary list rows never
 * carry the other two, so both branches and `directorScoreStars` were
 * unreachable. Removed 2026-10-19; the Activity list keeps its own verdict
 * tooltip and LlmCallsTable its own thinking chip.
 */
export function ExecutionValueBadges({ businessOutcome }: ExecutionValueBadgesProps) {
  if (!businessOutcome || businessOutcome === 'unknown') return null;
  return <BusinessOutcomeBadge outcome={businessOutcome} variant="compact" />;
}
