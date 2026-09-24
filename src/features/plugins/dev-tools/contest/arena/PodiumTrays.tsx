// Sorting in the photo finish: ONE compact four-way choice for the variant on
// screen (Winner / Shortlist / Impractical / Failure — pressing the active one
// clears it), and below it a small summary of which keys sit in each bucket.
// A key in the summary brings that variant up.
import { Ban, Medal, Trophy, Wrench } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';

import type { ReviewDraft } from '../hooks/useReviewDraft';
import { bucketLabel } from '../model/labels';
import { REVIEW_BUCKETS, setBucket, variantReview } from '../model/reviewModel';
import type { TrayId } from './arenaModel';

const BUCKET_ORDER: readonly ContestReviewBucket[] = ['winner', 'shortlist', 'impractical', 'failure'];

const BUCKET_ICON: Record<ContestReviewBucket, typeof Trophy> = {
  winner: Trophy,
  shortlist: Medal,
  impractical: Wrench,
  failure: Ban,
};

const BUCKET_TEXT: Record<ContestReviewBucket, string> = {
  winner: 'text-status-success',
  shortlist: 'text-status-info',
  impractical: 'text-status-warning',
  failure: 'text-status-error',
};

export interface PodiumTraysProps {
  trays: Record<TrayId, string[]>;
  current: string | null;
  draft: ReviewDraft;
  onSelect: (key: string) => void;
}

export function PodiumTrays({ trays, current, draft, onSelect }: PodiumTraysProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  const currentBucket = current && draft.review ? variantReview(draft.review, current).bucket : null;
  const move = (bucket: ContestReviewBucket) => {
    if (!current) return;
    draft.apply((r) => setBucket(r, current, currentBucket === bucket ? null : bucket));
  };
  // REVIEW_BUCKETS is the wire vocabulary; keep the display order explicit
  // but never show a bucket the model does not know.
  const buckets = BUCKET_ORDER.filter((b) => REVIEW_BUCKETS.includes(b));

  return (
    <section className="space-y-2" aria-label={a.sort_label} data-testid="arena-podium">
      <h3 className="typo-label">{a.sort_label}</h3>
      <div role="group" aria-label={a.sort_label} className="grid grid-cols-4 gap-1">
        {buckets.map((b) => {
          const Icon = BUCKET_ICON[b];
          const active = currentBucket === b;
          return (
            <Button
              key={b}
              size="xs"
              variant={active ? 'secondary' : 'ghost'}
              className={`justify-center typo-caption ${active ? 'text-foreground' : ''}`}
              icon={<Icon className={`w-3.5 h-3.5 ${BUCKET_TEXT[b]}`} />}
              aria-pressed={active}
              disabled={!current}
              onClick={() => move(b)}
              data-testid={`arena-tray-move-${b}`}
            >
              {bucketLabel(s, b)}
            </Button>
          );
        })}
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 typo-caption">
        {buckets.map((b) => (
          <SummaryRow key={b} id={b} label={bucketLabel(s, b)} keys={trays[b]} current={current} onSelect={onSelect} />
        ))}
        {trays.unsorted.length > 0 && (
          <SummaryRow id="unsorted" label={s.bucket_none} keys={trays.unsorted} current={current} onSelect={onSelect} />
        )}
      </dl>
    </section>
  );
}

interface SummaryRowProps {
  id: TrayId;
  label: string;
  keys: string[];
  current: string | null;
  onSelect: (key: string) => void;
}

function SummaryRow({ id, label, keys, current, onSelect }: SummaryRowProps) {
  return (
    <div className="contents" data-testid={`arena-tray-${id}`}>
      <dt>{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-x-2">
        {keys.length === 0 ? (
          <span aria-hidden>—</span>
        ) : (
          keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(k)}
              aria-current={k === current ? 'true' : undefined}
              className={`rounded-interactive focus-ring hover:underline ${k === current ? 'text-primary' : 'text-foreground'}`}
            >
              {k}
            </button>
          ))
        )}
      </dd>
    </div>
  );
}
