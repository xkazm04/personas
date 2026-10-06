/**
 * Fusion · the answers as separate cards that FLY IN over the app. Each card
 * leaves the rail's attention circle (`[data-fusion-anchor]`) small and
 * transparent and lands in its slot under the question, staggered left to
 * right, on the product's ease; reduced motion simply shows them. Measured
 * before paint (`useLayoutEffect`), so a card never flashes in its slot first.
 *
 * A card is one keyed answer: its number large, the verb as its one emphasis,
 * its consequence small. The card she recommends - once she has, by the
 * product's reveal rule (0 / Ask Athena) - carries her seal, her label and her
 * one-line why, on a branded edge; the others stay plain. A typed answer
 * (a session's guidance question, an approval note) is a wide card of its own.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { animate } from 'framer-motion';
import { useLayoutEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { CardChoice, CardModel } from '../c/bodies/model';
import { AthenaSeal } from './AthenaSeal';
import { FUSION_COPY as F } from './copy';
import { EASE, inline } from './text';

function toneOf(choice: CardChoice): string {
  if (choice.tone === 'danger') return 'var(--status-error)';
  if (choice.tone === 'neutral') return 'var(--foreground)';
  return 'var(--primary)';
}

/** The cards' flight: from the attention circle to each card's own slot. */
export function useFlight(listRef: React.RefObject<HTMLOListElement | null>, count: number) {
  const { shouldAnimate } = useMotion();
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !shouldAnimate) return;
    const anchor = document.querySelector('[data-fusion-anchor]')?.getBoundingClientRect();
    const cards = Array.from(list.children) as HTMLElement[];
    // Measure the slots untransformed, then hide them before this frame paints.
    for (const el of cards) el.style.transform = '';
    const rects = cards.map((el) => el.getBoundingClientRect());
    for (const el of cards) el.style.opacity = '0';
    const runs = cards.map((el, i) => {
      const r = rects[i]!;
      const dx = anchor ? anchor.left + anchor.width / 2 - (r.left + r.width / 2) : 220;
      const dy = anchor ? anchor.top + anchor.height / 2 - (r.top + r.height / 2) : -120;
      return animate(
        el,
        { x: [dx, 0], y: [dy, 0], scale: [0.18, 1], opacity: [0, 1] },
        { duration: 0.62, delay: 0.1 + i * 0.09, ease: EASE },
      );
    });
    return () => {
      runs.forEach((r) => r.stop());
      for (const el of cards) {
        el.style.transform = '';
        el.style.opacity = '';
      }
    };
  }, [listRef, count, shouldAnimate]);
}

/**
 * `herOwn`: the pick is HER recommendation (a decision, revealed on asking),
 * so it carries her seal. An approval's pick is the product's static risk
 * read, not her word: it is marked as the safe answer without her face.
 */
export function AnswerCards({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const rec = model.recommendation;
  const field = model.field;
  const cards = model.choices.length + (field ? 1 : 0);
  useFlight(listRef, cards);
  if (cards === 0) return null;

  return (
    <ol
      ref={listRef}
      className={`fu-answers${model.choices.length > 3 ? ' is-many' : ''}`}
      style={{ ['--n' as string]: Math.max(1, Math.min(3, model.choices.length)) }}
      aria-label={F.keys.choose}
      data-testid="companion-fusion-answers"
    >
      {model.choices.map((c, i) => {
        const pick = c.recommended && !!rec?.revealed;
        return (
          <li key={c.key} className="fu-answer-slot">
            <Button
              variant="ghost"
              className={`fu-answer fu-glass${pick ? (herOwn ? ' is-pick' : ' is-safe') : ''}`}
              style={{ ['--t' as string]: toneOf(c) }}
              data-fusion-answer=""
              data-card-choice=""
              data-testid={`companion-fusion-answer-${i + 1}`}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              disabled={model.busy}
              loading={c.busy}
              onClick={() => void c.run()}
            >
              <span className="fu-answer-key typo-data-lg">{i + 1}</span>
              <span className="typo-title-lg text-foreground fu-answer-label">{inline(c.label)}</span>
              {c.hint && <span className="typo-body fu-answer-hint">{c.hint}</span>}
              {pick && rec && (
                <span className="fu-answer-her" data-testid={herOwn ? 'companion-fusion-her-pick' : 'companion-fusion-safe-pick'}>
                  {herOwn ? <AthenaSeal size={30} /> : <ShieldCheck className="fu-verdict-g" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="fu-her-head">
                      <span className={`typo-label ${herOwn ? 'text-primary' : 'text-status-success'}`}>{rec.label}</span>
                      <kbd className="fu-kbd typo-caption">Enter</kbd>
                    </span>
                    {rec.text && <span className="typo-body text-foreground">{rec.text}</span>}
                  </span>
                </span>
              )}
            </Button>
          </li>
        );
      })}
      {field && (
        <li className="fu-answer-slot is-wide">
          <label className="fu-answer fu-glass is-field">
            <span className="typo-label text-foreground">{field.label || F.answer}</span>
            <textarea
              className={`${INPUT_FIELD} typo-body`}
              rows={field.multiline ? 3 : 1}
              value={field.value}
              placeholder={field.placeholder}
              disabled={field.disabled}
              onChange={(e) => field.onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && field.submit?.enabled) {
                  e.preventDefault();
                  void field.submit.run();
                }
              }}
            />
            {field.submit && (
              <span className="flex w-full justify-end">
                <Button variant="primary" size="sm" loading={field.submit.busy} disabled={!field.submit.enabled} onClick={() => void field.submit!.run()}>
                  {field.submit.label}
                </Button>
              </span>
            )}
          </label>
        </li>
      )}
    </ol>
  );
}
