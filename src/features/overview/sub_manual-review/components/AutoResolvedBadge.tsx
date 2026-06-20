import { ShieldCheck } from 'lucide-react';
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
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption border border-amber-400/30 bg-amber-500/10 text-amber-300/90 ${className}`}
      title={tip}
    >
      <ShieldCheck className="w-3 h-3" />
      {t.overview.review.auto_resolved.badge}
    </span>
  );
}
