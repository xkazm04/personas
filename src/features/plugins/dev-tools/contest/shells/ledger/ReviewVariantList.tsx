// The review split's left pane: every variant as one line — key, title,
// concept, size, the seat that built it, its tray, its pins, the judges'
// mean. j/k (or a click) moves the active line. Extractable.
import { MapPin } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReview } from '@/lib/bindings/ContestReview';

import { bucketLabel, bucketTone } from '../../model/labels';
import { variantReview } from '../../model/reviewModel';
import { LEDGER_COPY as C, fill } from './copy';
import { variantSeatSpec } from './model/ledgerFacts';
import { SeatSpecChips } from './SeatSpecChips';

export interface ReviewVariantListProps {
  detail: ContestDetail;
  review: ContestReview | null;
  activeIndex: number;
  onActivate: (index: number) => void;
}

export function ReviewVariantList({ detail, review, activeIndex, onActivate }: ReviewVariantListProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const means = new Map((detail.scoreboard?.rows ?? []).map((r) => [r.key, r.mean]));

  return (
    <nav aria-label={C.reviewList} className="min-w-0" data-testid="ledger-review-list">
      <h4 className="mb-1.5 typo-label text-foreground">{C.reviewList}</h4>
      <ol className="space-y-1">
        {detail.variants.map((v, i) => {
          const vr = review ? variantReview(review, v.key) : null;
          const spec = variantSeatSpec(detail, v);
          const active = i === activeIndex;
          return (
            <li key={v.key}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onActivate(i)}
                className={`w-full space-y-1 rounded-interactive border-l-2 px-2.5 py-2 text-left focus-ring transition-colors hover:bg-secondary/30 ${
                  active ? 'border-l-primary bg-primary/8' : 'border-l-transparent'
                } ${v.present ? '' : 'opacity-60'}`}
                data-testid={`ledger-review-item-${v.key}`}
              >
                <span className="flex items-center gap-2">
                  <span className="typo-data text-foreground">{v.key}</span>
                  <span className="min-w-0 flex-1 truncate typo-title">{v.title || '—'}</span>
                  {vr?.bucket && (
                    <StatusBadge variant={bucketTone(vr.bucket)} size="sm" pill>
                      {bucketLabel(s, vr.bucket)}
                    </StatusBadge>
                  )}
                </span>
                {v.concept && <span className="block truncate typo-caption text-foreground">{v.concept}</span>}
                <span className="flex flex-wrap items-center gap-2 typo-caption text-foreground">
                  {spec && <SeatSpecChips spec={spec} />}
                  <Numeric value={v.bytes} unit="compact" />
                  {vr && vr.pins.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin aria-hidden className="h-3 w-3" />
                      {fill(C.reviewPins, { n: vr.pins.length })}
                    </span>
                  )}
                  {means.has(v.key) && (
                    <span>
                      {C.scoreMean} <Numeric value={means.get(v.key) ?? null} precision={2} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
