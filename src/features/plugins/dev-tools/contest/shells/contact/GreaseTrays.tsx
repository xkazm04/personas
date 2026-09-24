// Sorting as a grease pencil. `GreaseMarks` marks the frame on the loupe
// (✕ failure · ~ impractical · ○ shortlist · ★ winner; the same glyph rubs it
// out, and the typed glyph does the same). `SortTrays` shows where every
// frame ended up, each key a jump back to that frame.
// Extractable: both — a bucket picker with glyphs, and a bucket overview.
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReview } from '@/lib/bindings/ContestReview';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';

import type { ReviewDraft } from '../../hooks/useReviewDraft';
import { bucketLabel } from '../../model/labels';
import { REVIEW_BUCKETS, keysInBucket, setBucket, variantReview } from '../../model/reviewModel';
import { CONTACT_COPY as C } from './copy';
import { MARK_GLYPH } from './contactModel';
import { MARK_TEXT } from './FrameCell';

const MARK_KEY: Readonly<Record<ContestReviewBucket, string>> = {
  failure: 'x',
  impractical: '~',
  shortlist: 'o',
  winner: '*',
};

export function GreaseMarks({ draft, variantKey }: { draft: ReviewDraft; variantKey: string }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  if (!draft.review) return null;
  const current = variantReview(draft.review, variantKey).bucket;
  return (
    <div className="space-y-1.5" data-testid="contact-grease-marks">
      <p className="typo-label text-foreground">{C.marksTitle}</p>
      <div role="group" aria-label={C.marksTitle} className="grid grid-cols-2 gap-1.5">
        {REVIEW_BUCKETS.map((b) => {
          const on = current === b;
          return (
            <Button
              key={b}
              size="sm"
              variant={on ? 'secondary' : 'ghost'}
              aria-pressed={on}
              aria-keyshortcuts={MARK_KEY[b]}
              onClick={() => draft.apply((r) => setBucket(r, variantKey, on ? null : b))}
              className={`justify-start ${on ? 'border border-primary/30' : ''}`}
              data-testid={`contact-grease-${b}`}
            >
              <span className={`typo-heading ${MARK_TEXT[b]}`} aria-hidden>
                {MARK_GLYPH[b]}
              </span>
              <span className="typo-caption text-foreground">{bucketLabel(s, b)}</span>
              <kbd className="ml-auto typo-label text-foreground">{MARK_KEY[b]}</kbd>
            </Button>
          );
        })}
      </div>
      <p className="typo-caption text-foreground">{C.marksHint}</p>
    </div>
  );
}

export interface SortTraysProps {
  review: ContestReview;
  current: string | null;
  onPick: (key: string) => void;
}

export function SortTrays({ review, current, onPick }: SortTraysProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const unmarked = review.variants.filter((v) => v.bucket === null).map((v) => v.key);
  const trays: { id: ContestReviewBucket | 'none'; label: string; glyph: string; cls: string; keys: string[] }[] = [
    ...[...REVIEW_BUCKETS].reverse().map((b) => ({
      id: b,
      label: bucketLabel(s, b),
      glyph: MARK_GLYPH[b],
      cls: MARK_TEXT[b],
      keys: keysInBucket(review, b),
    })),
    { id: 'none', label: C.unsorted, glyph: '·', cls: 'text-foreground', keys: unmarked },
  ];
  return (
    <section className="space-y-1.5" aria-label={C.traysTitle} data-testid="contact-sort-trays">
      <h4 className="typo-label text-foreground">{C.traysTitle}</h4>
      <ul className="space-y-1">
        {trays.map((tray) => (
          <li key={tray.id} className="flex flex-wrap items-center gap-1.5" data-testid={`contact-sort-${tray.id}`}>
            <span className={`w-5 text-center typo-heading ${tray.cls}`} aria-hidden>
              {tray.glyph}
            </span>
            <span className="typo-caption text-foreground w-24">{tray.label}</span>
            {tray.keys.length === 0 ? (
              <span className="typo-caption text-foreground">{C.trayEmpty}</span>
            ) : (
              tray.keys.map((k) => (
                <Button key={k} size="xs" variant={k === current ? 'primary' : 'secondary'} onClick={() => onPick(k)}>
                  {k}
                </Button>
              ))
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
