import { Brain } from 'lucide-react';
import { BusinessOutcomeBadge } from '@/features/shared/components/display/BusinessOutcomeBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useTranslation } from '@/i18n/useTranslation';

/** Render a 0-5 Director verdict score as filled/hollow stars (★★★☆☆). */
export function directorScoreStars(score: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(score)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

interface ExecutionValueBadgesProps {
  businessOutcome?: string | null;
  directorScore?: number | null;
  thinkingLevel?: string | null;
}

/**
 * Compact value-verdict badges for an execution row: business outcome (did the
 * run deliver real work), the Director's 0-5 score, and the reasoning-effort
 * ("thinking") level. Mirrors the Overview activity feed's presentation so the
 * editor run list reads the same. Each badge only renders when its field is
 * present — the summary list payload carries `business_outcome`, while
 * `director_score` / `thinking_level` surface once a row is hydrated.
 */
export function ExecutionValueBadges({ businessOutcome, directorScore, thinkingLevel }: ExecutionValueBadgesProps) {
  const { t, tx } = useTranslation();
  return (
    <>
      {businessOutcome && businessOutcome !== 'unknown' && (
        <BusinessOutcomeBadge outcome={businessOutcome} variant="compact" />
      )}
      {directorScore != null && (
        <Tooltip content={tx(t.agents.activity.verdict_tooltip, { score: directorScore })}>
          <span className="typo-code text-status-warning tabular-nums whitespace-nowrap">
            {directorScoreStars(directorScore)}
          </span>
        </Tooltip>
      )}
      {thinkingLevel && (
        <Tooltip content={t.agents.executions.thinking_tooltip}>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-card bg-primary/8 text-primary/80 border border-primary/20">
            <Brain className="w-2.5 h-2.5" />{tokenLabel(t, 'thinking', thinkingLevel)}
          </span>
        </Tooltip>
      )}
    </>
  );
}
