/**
 * Fusion · decision v3 - one answer as one palette row, a card of its own:
 * its key cap, the choice, the consequence in the muted right-hand column
 * (the palette's `description` slot), and the palette's trailing arrow while
 * it is highlighted. ↑/↓ move the highlight exactly like the palette's list
 * (`useAnswerKeys` moves focus; the row's focus IS the highlight, drawn as the
 * palette's 2px leading edge in the row's tone). A danger answer carries the
 * error tone on its key and edge.
 *
 * Her pick (after 0 / Ask Athena) wears her brand: a primary edge and wash,
 * a "Recommended" chip with her face, ↵ as its key, and her reason opening
 * under it beside her seal. An approval's low-risk pick is the product's
 * risk read, not her word: a success chip with a shield and no face.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { motion } from 'framer-motion';
import { forwardRef } from 'react';
import { ArrowRight, Check, ShieldCheck, TriangleAlert } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { CardChoice, CardRecommendation } from '../../../c/bodies/model';
import { AthenaSeal } from '../../AthenaSeal';
import { EASE, inline } from '../../text';
import { Keycap } from './parts';
import { PALETTE_COPY as P } from './copy';

function toneOf(c: CardChoice): string {
  if (c.tone === 'danger') return 'var(--status-error)';
  if (c.tone === 'neutral') return 'var(--foreground)';
  return 'var(--primary)';
}

function Why({ rec, herOwn }: { rec: CardRecommendation; herOwn: boolean }) {
  const { shouldAnimate } = useMotion();
  if (!rec.text) return null;
  return (
    <motion.span
      className="fd3-why"
      initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1 }}
      transition={{ duration: 0.32, ease: EASE, delay: 0.08 }}
    >
      <span className="fd3-why-in">
        {herOwn ? <AthenaSeal size={26} /> : <ShieldCheck className="fd3-why-g" aria-hidden />}
        <span className="typo-body text-foreground">{rec.text}</span>
      </span>
    </motion.span>
  );
}

export const AnswerRow = forwardRef<
  HTMLButtonElement,
  {
    choice: CardChoice;
    index: number;
    pick: boolean;
    herOwn: boolean;
    rec: CardRecommendation | null;
    disabled: boolean;
    taken: boolean;
    dimmed: boolean;
    onTake: () => void;
  }
>(function AnswerRow({ choice: c, index: i, pick, herOwn, rec, disabled, taken, dimmed, onTake }, ref) {
  const state = [pick && (herOwn ? 'is-pick' : 'is-safe'), c.tone === 'danger' && 'is-danger', taken && 'is-taken', dimmed && 'is-dimmed']
    .filter(Boolean)
    .join(' ');
  return (
    <Button
      ref={ref}
      variant="ghost"
      className={`fd3-row fd3-surface glass-md rounded-card ${state}`}
      style={{ ['--t' as string]: pick ? (herOwn ? 'var(--primary)' : 'var(--status-success)') : toneOf(c) }}
      data-fusion-answer=""
      data-card-choice=""
      data-testid={`companion-fusion-d3-answer-${i + 1}`}
      aria-keyshortcuts={[i < 9 ? String(i + 1) : '', pick ? 'Enter' : ''].filter(Boolean).join(' ') || undefined}
      disabled={disabled}
      loading={c.busy}
      onClick={() => {
        onTake();
        void c.run();
      }}
    >
      <span className="fd3-lead">
        {taken ? <Check className="fd3-check" aria-hidden /> : <Keycap size="lg">{i < 9 ? i + 1 : '·'}</Keycap>}
      </span>
      <span className="fd3-main">
        <span className="fd3-label typo-title text-foreground">{inline(c.label)}</span>
        {c.hint && (
          <span className="fd3-conseq typo-caption">
            {c.tone === 'danger' && <TriangleAlert className="fd3-conseq-g" aria-hidden />}
            {inline(c.hint)}
          </span>
        )}
      </span>
      <span className="fd3-end">
        {pick && rec && (
          <span
            className={`fd3-chip typo-label ${herOwn ? 'is-her' : 'is-safe'}`}
            data-testid={herOwn ? 'companion-fusion-d3-her-pick' : 'companion-fusion-d3-safe-pick'}
          >
            {!herOwn && <ShieldCheck aria-hidden />}
            {herOwn ? P.recommended : P.safer}
          </span>
        )}
        {pick ? <Keycap>{P.keys.enter}</Keycap> : <ArrowRight className="fd3-arrow" aria-hidden />}
      </span>
      {pick && rec && <Why rec={rec} herOwn={herOwn} />}
    </Button>
  );
});
