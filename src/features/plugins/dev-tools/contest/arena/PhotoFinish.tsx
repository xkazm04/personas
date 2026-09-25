// The review layer: a full-screen lightbox entered from a lane's tiles. One
// header row (the race, frame width, pin mode, save state, prev / next), one
// large live frame with pins over a filmstrip of every variant, and beside it
// a calm side panel: who made it, its facts, the four-way sort, the note and
// pins, the field note, the stewards' scoreboard (when judges ran), the verdict.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import { useTranslation } from '@/i18n/useTranslation';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { DecisionBar } from '../components/DecisionBar';
import { FieldNoteEditor, ReviewSheet, SaveState } from '../components/ReviewSheet';
import { VariantFrame } from '../components/VariantFrame';
import type { ReviewDraft } from '../hooks/useReviewDraft';
import { DESIGN_WIDTHS, type DesignWidth } from '../model/pinMath';
import { addPin, variantReview } from '../model/reviewModel';
import { makerSpec, recordedBucket, stepKey, trays } from './arenaModel';
import { PhotoFacts } from './PhotoFacts';
import { PodiumTrays } from './PodiumTrays';
import { StewardsScoreboard } from './StewardsScoreboard';
import { VariantTile } from './VariantTile';

export interface PhotoFinishProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  currentKey: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

/** A key typed here belongs to the control, not the lightbox (caret movement,
 *  a listbox or radio group's own arrows). */
function ownsArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('input, textarea, select')) return true;
  return target.closest('[role="listbox"], [role="menu"], [role="radiogroup"], [role="slider"], [role="tablist"]') !== null;
}

export function PhotoFinish({ detail, draft, currentKey, onSelect, onClose }: PhotoFinishProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  const [width, setWidth] = useState<DesignWidth>(1280);
  const [pinMode, setPinMode] = useState(false);
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
  // Arrows step the filmstrip, one rung above the overlay's own Escape/Tab
  // handler (which lets arrows through), unless a text field owns them.
  useAppKeyboard(
    (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (ownsArrows(event.target) || keys.length < 2) return false;
      event.preventDefault();
      go(event.key === 'ArrowRight' ? 1 : -1);
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  return (
    <FullScreenOverlay onClose={onClose} ariaLabel={`${a.photo_finish} · ${detail.summary.title}`} testId="arena-photo-finish">
      <div className="flex h-full min-h-0 flex-col typo-body">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-primary/10 px-5 pb-3 pr-16">
          <div className="min-w-0 flex-1">
            <p className="typo-label">{a.photo_finish}</p>
            <h2 className="typo-title-lg line-clamp-2 break-words">{detail.summary.title}</h2>
          </div>
          <div role="group" aria-label={s.frame_width_label} className="inline-flex gap-0.5">
            {DESIGN_WIDTHS.map((w) => (
              <Button key={w} size="xs" variant={w === width ? 'secondary' : 'ghost'} aria-pressed={w === width} onClick={() => setWidth(w)}>
                <span className="font-data">{w}</span>
              </Button>
            ))}
          </div>
          {variant && (
            <Button
              size="xs"
              variant={pinMode ? 'secondary' : 'ghost'}
              aria-pressed={pinMode}
              icon={<MapPin className="w-3 h-3" />}
              onClick={() => setPinMode((on) => !on)}
              data-testid={`contest-frame-pin-mode-${variant.key}`}
            >
              {s.frame_pin_mode}
            </Button>
          )}
          <SaveState draft={draft} />
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={a.lightbox_prev} onClick={() => go(-1)} disabled={keys.length < 2}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="typo-data">{index >= 0 ? tx(a.lightbox_counter, { i: index + 1, n: keys.length }) : '—'}</span>
            <Button size="icon-sm" variant="ghost" aria-label={a.lightbox_next} onClick={() => go(1)} disabled={keys.length < 2}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {pinMode && <p className="typo-caption">{s.frame_pin_mode_hint}</p>}
            {variant && (
              <VariantFrame
                variant={variant}
                pins={pins}
                width={width}
                onWidthChange={setWidth}
                pinMode={pinMode}
                onPinModeChange={setPinMode}
                showControls={false}
                onAddPin={(pin) => draft.apply((r) => addPin(r, variant.key, pin))}
              />
            )}
            <ul className="flex shrink-0 gap-1.5 overflow-x-auto pb-1" aria-label={a.variants_label} data-testid="arena-filmstrip">
              {detail.variants.map((v) => (
                <li key={v.key} className="shrink-0">
                  <VariantTile
                    variant={v}
                    active={v.key === current}
                    bucket={recordedBucket(review, detail.summary, v.key)}
                    onOpen={onSelect}
                  />
                </li>
              ))}
            </ul>
          </div>

          <aside className="min-h-0 space-y-5 overflow-y-auto pr-1" aria-label={a.review_panel}>
            {variant && <PhotoFacts variant={variant} maker={maker} />}
            <PodiumTrays trays={trays(review, detail.variants, detail.summary)} current={current} draft={draft} onSelect={onSelect} />
            {variant && <ReviewSheet variant={variant} draft={draft} showBuckets={false} showHeader={false} />}
            <FieldNoteEditor draft={draft} />
            {detail.scoreboard && <StewardsScoreboard
                scoreboard={detail.scoreboard}
                current={current}
                onSelect={onSelect}
                specOf={(id) => detail.seats.find((seat) => seat.seatId === id)?.spec ?? id}
              />}
            <DecisionBar detail={detail} draft={draft} onDecided={onClose} onRefined={onClose} />
          </aside>
        </div>
      </div>
    </FullScreenOverlay>
  );
}
