// The review layer: a full-screen lightbox entered from a lane's tiles. One
// large live frame with pins, a filmstrip of every variant, and beside it the
// variant's review sheet, the podium and pits, the field notes, the stewards'
// scoreboard (when judges ran) and the verdict.
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { DecisionBar } from '../components/DecisionBar';
import { FieldNoteEditor, ReviewSheet, SaveState } from '../components/ReviewSheet';
import { VariantFrame } from '../components/VariantFrame';
import type { ReviewDraft } from '../hooks/useReviewDraft';
import { addPin, variantReview } from '../model/reviewModel';
import { makerSpec, stepKey, trays } from './arenaModel';
import { ARENA } from './copy';
import { PodiumTrays } from './PodiumTrays';
import { SeatSpecChips } from './SeatSpecChips';
import { StewardsScoreboard } from './StewardsScoreboard';
import { VariantTile } from './VariantTile';

export interface PhotoFinishProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  currentKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function PhotoFinish({ detail, draft, currentKey, onSelect, onClose }: PhotoFinishProps) {
  const keys = detail.variants.map((v) => v.key);
  const variant = detail.variants.find((v) => v.key === currentKey) ?? detail.variants[0] ?? null;
  const current = variant?.key ?? null;
  const index = current ? keys.indexOf(current) : -1;
  const review = draft.review;
  const pins = review && current ? variantReview(review, current).pins : [];
  const maker = variant ? makerSpec(detail, variant) : null;
  const go = (delta: 1 | -1) => {
    const next = stepKey(keys, current, delta);
    if (next) onSelect(next);
  };

  return (
    <FullScreenOverlay onClose={onClose} ariaLabel={`${ARENA.lightboxLabel} · ${detail.summary.title}`} testId="arena-photo-finish">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-primary/10 px-5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="typo-label text-primary">{ARENA.lightboxLabel}</p>
            <h2 className="typo-heading-lg truncate">{detail.summary.title}</h2>
          </div>
          <SaveState draft={draft} />
          <div className="flex items-center gap-1.5">
            <Button size="icon-sm" variant="ghost" aria-label={ARENA.lightboxPrev} onClick={() => go(-1)} disabled={keys.length < 2}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="typo-caption text-foreground">{index >= 0 ? ARENA.lightboxCounter(index + 1, keys.length) : '—'}</span>
            <Button size="icon-sm" variant="ghost" aria-label={ARENA.lightboxNext} onClick={() => go(1)} disabled={keys.length < 2}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {variant && (
              <VariantFrame
                variant={variant}
                pins={pins}
                onAddPin={(pin) => draft.apply((r) => addPin(r, variant.key, pin))}
              />
            )}
            <ul className="flex shrink-0 gap-2 overflow-x-auto pb-1" aria-label={ARENA.lanesLabel} data-testid="arena-filmstrip">
              {detail.variants.map((v) => (
                <li key={v.key} className="shrink-0">
                  <VariantTile
                    variant={v}
                    compact
                    active={v.key === current}
                    bucket={review ? variantReview(review, v.key).bucket : null}
                    onOpen={onSelect}
                  />
                </li>
              ))}
            </ul>
          </div>

          <aside className="min-h-0 space-y-5 overflow-y-auto pr-1" aria-label={ARENA.podium}>
            {maker && (
              <div className="space-y-1">
                <p className="typo-label text-foreground">{ARENA.madeBy}</p>
                <SeatSpecChips spec={maker} />
              </div>
            )}
            {variant && <ReviewSheet variant={variant} draft={draft} showBuckets={false} />}
            <PodiumTrays trays={trays(review, detail.variants)} current={current} draft={draft} onSelect={onSelect} />
            <FieldNoteEditor draft={draft} />
            {detail.scoreboard && <StewardsScoreboard scoreboard={detail.scoreboard} current={current} onSelect={onSelect} />}
            <DecisionBar detail={detail} draft={draft} onDecided={onClose} onRefined={onClose} />
          </aside>
        </div>
      </div>
    </FullScreenOverlay>
  );
}
