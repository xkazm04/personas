// Review layer: the lightbox. One large frame under the loupe (pin mode is
// the loupe), the filmstrip below it, the margin beside it; then the notes
// on the whole roll, the judges' scores one click down, and the decision.
import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { DecisionBar } from '../../components/DecisionBar';
import { FieldNoteEditor } from '../../components/ReviewSheet';
import { VariantFrame } from '../../components/VariantFrame';
import type { ReviewDraft } from '../../hooks/useReviewDraft';
import { addPin, setBucket, variantReview } from '../../model/reviewModel';
import { CONTACT_COPY as C, fill } from './copy';
import { stepKey } from './contactModel';
import { Filmstrip } from './Filmstrip';
import { LoupeSide } from './LoupeSide';
import { ScoreSheet } from './ScoreSheet';
import { useLoupeKeys } from './useLoupeKeys';

export interface LoupePanelProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  initialKey: string | null;
  onBack: () => void;
}

export function LoupePanel({ detail, draft, initialKey, onBack }: LoupePanelProps) {
  const keys = detail.variants.map((v) => v.key);
  const [picked, setPicked] = useState<string | null>(initialKey);
  const current = picked && keys.includes(picked) ? picked : (keys[0] ?? null);
  const variant = detail.variants.find((v) => v.key === current) ?? null;
  const [pinMode, setPinMode] = useState(false);
  const [unmasked, setUnmasked] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);
  const decided = detail.summary.phase === 'decided';

  const pick = (key: string) => {
    setPicked(key);
    setPinMode(false);
  };
  const step = (delta: 1 | -1) => {
    const next = stepKey(keys, current, delta);
    if (next) pick(next);
  };

  useLoupeKeys(
    {
      step,
      mark: (bucket) => {
        if (!current || !draft.review) return;
        const on = variantReview(draft.review, current).bucket === bucket;
        draft.apply((r) => setBucket(r, current, on ? null : bucket));
      },
      togglePin: () => setPinMode((v) => !v),
      back: onBack,
    },
    true,
  );

  if (!variant) return null;
  const pins = draft.review ? variantReview(draft.review, variant.key).pins : [];

  return (
    <div className="space-y-5" data-testid="contact-loupe">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon-sm" variant="ghost" aria-label={C.prevFrame} onClick={() => step(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={C.nextFrame} onClick={() => step(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="typo-heading">{variant.key}</span>
            {variant.title && <span className="typo-title-lg min-w-0 truncate">{variant.title}</span>}
            <span className="typo-caption text-foreground">
              {fill(C.frameOf, { n: keys.indexOf(variant.key) + 1, total: keys.length })}
            </span>
            <span className="ml-auto typo-caption text-foreground">{C.loupeKeys}</span>
          </div>
          <VariantFrame
            variant={variant}
            pins={pins}
            pinMode={pinMode}
            onPinModeChange={setPinMode}
            onAddPin={(pin) => draft.apply((r) => addPin(r, variant.key, pin))}
          />
          <Filmstrip variants={detail.variants} review={draft.review} current={variant.key} onPick={pick} />
        </div>
        <LoupeSide
          detail={detail}
          variant={variant}
          draft={draft}
          unmasked={unmasked}
          onUnmaskedChange={setUnmasked}
          onPick={pick}
        />
      </div>

      <section className="space-y-2" aria-label={C.fieldNotesTitle}>
        <h3 className="typo-heading">{C.fieldNotesTitle}</h3>
        <FieldNoteEditor draft={draft} />
      </section>

      {detail.scoreboard && detail.scoreboard.rows.length > 0 && (
        <section className="space-y-2" aria-label={C.scoresTitle}>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={scoresOpen}
            icon={scoresOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            onClick={() => setScoresOpen((v) => !v)}
            data-testid="contact-scores-toggle"
          >
            {scoresOpen ? C.scoresHide : C.scoresShow}
          </Button>
          {scoresOpen && <ScoreSheet scoreboard={detail.scoreboard} current={variant.key} onPick={pick} />}
        </section>
      )}

      {!decided && (
        <section className="space-y-2 rounded-card border border-primary/15 bg-secondary/15 p-3" aria-label={C.decideTitle}>
          <h3 className="typo-heading">{C.decideTitle}</h3>
          <DecisionBar detail={detail} draft={draft} />
        </section>
      )}
    </div>
  );
}
