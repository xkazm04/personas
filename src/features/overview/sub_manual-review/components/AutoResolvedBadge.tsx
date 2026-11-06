import { ShieldCheck } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { detectAutoResolution } from '../libs/reviewHelpers';

interface AutoResolvedBadgeProps {
  review: { reviewer_notes: string | null };
  className?: string;
}

/**
 * Visible marker that a review was resolved automatically by its capability's
 * `review_policy` (trust_llm / auto_triage) rather than by a human — so the
 * silent bypass of the human queue is no longer invisible in the UI.
 * (UAT P5 — F-NO-CONFIDENCE-AUTORESOLVE.)
 */
export function AutoResolvedBadge({ review, className = '' }: AutoResolvedBadgeProps) {
  const { t } = useTranslation();
  const res = detectAutoResolution(review);
  if (!res) return null;
  const tip =
    res.kind === 'trust_llm'
      ? t.overview.review.auto_resolved.tip_trust_llm
      : t.overview.review.auto_resolved.tip_auto_triage;
  return (
    <Tooltip content={tip}><span
      className={`inline-flex items-center gap-1 typo-eyebrow text-status-warning ${className}`}
    >
      <ShieldCheck className="w-3 h-3" />
      {t.overview.review.auto_resolved.badge}
    </span></Tooltip>
  );
}
