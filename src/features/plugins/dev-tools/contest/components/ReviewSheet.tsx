// The owner's review of one variant: its tray, a verbatim note, its pins.
// Edits go through the contest's review draft (`useReviewDraft`), which
// autosaves and renders REVIEW.md on the backend.
import { Check, CircleDashed, FileText, Trash2, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { ReviewDraft } from '../hooks/useReviewDraft';
import { bucketLabel, bucketTone } from '../model/labels';
import { REVIEW_BUCKETS, removePin, setBucket, setField, setNote, updatePin, variantReview } from '../model/reviewModel';

export interface ReviewSheetProps {
  variant: ContestVariant;
  draft: ReviewDraft;
  /** Hide the bucket picker when the host shell sorts variants its own way
   *  (a podium, grease-pencil marks). Defaults to true. */
  showBuckets?: boolean;
  /** Hide the heading + facts when the host shell names the variant itself. */
  showHeader?: boolean;
  className?: string;
}

export function ReviewSheet({ variant, draft, showBuckets = true, showHeader = true, className = '' }: ReviewSheetProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  if (!draft.review) return null;
  const vr = variantReview(draft.review, variant.key);
  const pick = (bucket: ContestReviewBucket | null) => draft.apply((r) => setBucket(r, variant.key, bucket));

  return (
    <section
      className={`space-y-3 ${className}`}
      aria-label={tx(s.review_title, { key: variant.key })}
      data-testid={`contest-review-sheet-${variant.key}`}
    >
      {showHeader && (
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="typo-heading">{tx(s.review_title, { key: variant.key })}</h3>
          {vr.bucket && (
            <StatusBadge variant={bucketTone(vr.bucket)} size="md" pill>
              {bucketLabel(s, vr.bucket)}
            </StatusBadge>
          )}
          <SaveState draft={draft} />
        </div>
        <VariantFacts variant={variant} />
      </header>
      )}

      {showBuckets && (
      <div className="space-y-1.5">
        <p className="typo-label text-foreground">{s.bucket_label}</p>
        <div role="group" aria-label={s.bucket_label} className="flex flex-wrap gap-1.5">
          {REVIEW_BUCKETS.map((b) => (
            <Button
              key={b}
              size="xs"
              variant={vr.bucket === b ? 'primary' : 'secondary'}
              aria-pressed={vr.bucket === b}
              onClick={() => pick(vr.bucket === b ? null : b)}
              data-testid={`contest-review-bucket-${variant.key}-${b}`}
            >
              {bucketLabel(s, b)}
            </Button>
          ))}
          {vr.bucket && (
            <Button size="xs" variant="ghost" icon={<X className="w-3 h-3" />} onClick={() => pick(null)}>
              {s.bucket_clear}
            </Button>
          )}
        </div>
      </div>
      )}

      <label className="block space-y-1.5">
        <span className="typo-label text-foreground">{s.note_label}</span>
        <textarea
          value={vr.note}
          onChange={(e) => {
            const note = e.target.value;
            draft.apply((r) => setNote(r, variant.key, note));
          }}
          rows={5}
          placeholder={s.note_placeholder}
          className={`${INPUT_FIELD} resize-y`}
          data-testid={`contest-review-note-${variant.key}`}
        />
      </label>

      <div className="space-y-1.5">
        <p className="typo-label text-foreground">{s.pins_label}</p>
        {vr.pins.length === 0 ? (
          <p className="typo-caption text-foreground">{s.pins_empty}</p>
        ) : (
          <ol className="space-y-1.5">
            {vr.pins.map((pin, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-primary typo-label text-background">
                  {i + 1}
                </span>
                <input
                  value={pin.note}
                  onChange={(e) => {
                    const note = e.target.value;
                    draft.apply((r) => updatePin(r, variant.key, i, { note }));
                  }}
                  aria-label={tx(s.pin_note_aria, { n: i + 1 })}
                  className={INPUT_FIELD}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={tx(s.pin_remove, { n: i + 1 })}
                  onClick={() => draft.apply((r) => removePin(r, variant.key, i))}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The builder's own facts about the variant: title, concept, notes, size. */
export function VariantFacts({ variant }: { variant: ContestVariant }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 typo-caption text-foreground">
      {variant.title && (
        <>
          <dt className="typo-label">{s.variant_title}</dt>
          <dd className="min-w-0 break-words">{variant.title}</dd>
        </>
      )}
      {variant.concept && (
        <>
          <dt className="typo-label">{s.variant_concept}</dt>
          <dd className="min-w-0 break-words">{variant.concept}</dd>
        </>
      )}
      <dt className="typo-label">{s.variant_size}</dt>
      <dd>
        <Numeric value={variant.bytes} unit="compact" />
      </dd>
      {variant.hasNotes && (
        <dd className="col-span-2 flex items-center gap-1">
          <FileText className="w-3.5 h-3.5" aria-hidden /> {s.variant_has_notes}
        </dd>
      )}
      {!variant.present && <dd className="col-span-2">{s.variant_missing}</dd>}
    </dl>
  );
}

/** The contest-wide `## All` note. */
export function FieldNoteEditor({ draft, className = '' }: { draft: ReviewDraft; className?: string }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  if (!draft.review) return null;
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="typo-label text-foreground">{s.field_note_label}</span>
      <textarea
        value={draft.review.field}
        onChange={(e) => {
          const field = e.target.value;
          draft.apply((r) => setField(r, field));
        }}
        rows={4}
        placeholder={s.field_note_placeholder}
        className={`${INPUT_FIELD} resize-y`}
        data-testid="contest-review-field-note"
      />
    </label>
  );
}

/** Saving / saved / not saved — quiet, next to the heading. */
export function SaveState({ draft }: { draft: ReviewDraft }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const text = draft.lastError
    ? tx(s.save_failed, { message: resolveErrorTranslated(t, draft.lastError).message })
    : draft.isSaving || draft.dirty
      ? s.saving
      : s.saved;
  return (
    <span className="inline-flex items-center gap-1 typo-caption text-foreground" role="status">
      {draft.lastError ? null : draft.isSaving || draft.dirty ? (
        <CircleDashed className="w-3 h-3" aria-hidden />
      ) : (
        <Check className="w-3 h-3" aria-hidden />
      )}
      {text}
    </span>
  );
}
