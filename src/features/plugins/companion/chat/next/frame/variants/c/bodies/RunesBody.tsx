/**
 * Spread · Runes — the answers are the card. A short question heads the face
 * and the options lie below it as large tappable tokens, each carved with its
 * number key; Athena's pick glows. Everything that is reading rather than
 * deciding (context, her recommendation, hints, the machine detail) lives on
 * the card's reverse: "Turn over" flips the body to it and back.
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import { motion } from 'framer-motion';
import { Check, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { mix } from '../cardArt';
import { SPREAD_COPY as S } from '../copy';
import type { BodyProps } from './CardBody';
import type { CardChoice } from './model';
import { ChoiceButton, Deferrals, DetailsReveal, FieldInput, FieldSubmit, KeyCap, Problems, toneColor } from './parts';

const EASE = [0.22, 1, 0.36, 1] as const;

function Rune({ choice, index }: { choice: CardChoice; index: number }) {
  if (choice.key === 'approve') return <Check className="w-6 h-6" aria-hidden />;
  if (choice.key === 'reject' || choice.key === 'deny') return <X className="w-6 h-6" aria-hidden />;
  return <>{index + 1}</>;
}

export function RunesBody({ model, color, art }: BodyProps) {
  const { shouldAnimate } = useMotion();
  const [turned, setTurned] = useState(false);
  const rec = model.recommendation;
  const hasBack = !!(model.context || model.details || rec || model.choices.some((c) => c.hint));

  const cols = model.choices.length <= 2 ? 'grid-cols-2' : model.choices.length === 4 ? 'grid-cols-2' : 'grid-cols-3';

  const front = (
    <div className="h-full overflow-y-auto scrollbar-thin px-6 pt-4 pb-3 flex flex-col gap-4">
      <div className="text-center">
        <p className="typo-label uppercase tracking-[0.18em] text-foreground/85">{model.eyebrow}</p>
        <h2 className="mt-1.5 typo-heading-lg text-foreground leading-snug text-balance break-words">{model.question}</h2>
      </div>

      {model.choices.length > 0 && (
        <div className={`grid ${cols} gap-3`}>
          {model.choices.map((c, i) => {
            const tone = toneColor(c, color);
            return (
              <ChoiceButton
                key={c.key}
                choice={c}
                block
                className="relative justify-center border min-h-[128px]"
                style={{
                  borderColor: c.recommended ? tone : mix(tone, 40),
                  background: `radial-gradient(120% 90% at 50% 0%, ${mix(tone, c.recommended ? 30 : 14, 'var(--background)')}, var(--background))`,
                  boxShadow: c.recommended ? `0 0 0 1px ${tone}, 0 0 28px -6px ${tone}` : undefined,
                }}
              >
                {c.key === 'approve' || c.key === 'reject' || c.key === 'deny' ? (
                  <span className="absolute left-2.5 top-2.5">
                    <KeyCap color={tone}>{i + 1}</KeyCap>
                  </span>
                ) : null}
                <span className="flex flex-col items-center gap-2.5 py-1">
                  <span
                    className="grid place-items-center w-12 h-12 rounded-full border-2 typo-data-lg text-foreground"
                    style={{ borderColor: mix(tone, 80), background: mix(tone, 20, 'var(--background)') }}
                  >
                    <Rune choice={c} index={i} />
                  </span>
                  <span className="typo-body-lg text-foreground text-center whitespace-normal break-words">{c.label}</span>
                  {c.recommended && <span className="typo-label uppercase tracking-wider" style={{ color: mix(tone, 90, 'var(--foreground)') }}>{S.recommended}</span>}
                </span>
              </ChoiceButton>
            );
          })}
        </div>
      )}

      {model.field && (
        <div className="flex flex-col gap-2">
          <FieldInput field={model.field} />
          {model.field.submit && (
            <div className="flex justify-center">
              <FieldSubmit field={model.field} />
            </div>
          )}
        </div>
      )}
      <Problems model={model} />
    </div>
  );

  const back = (
    <div className="h-full overflow-y-auto scrollbar-thin px-6 pt-4 pb-3 flex flex-col gap-3">
      <p className="typo-label uppercase tracking-[0.18em] text-center text-foreground/85">{S.details}</p>
      {model.context && (
        <section>
          <h3 className="typo-label uppercase tracking-wider text-foreground/85">{S.context}</h3>
          <p className="mt-1 typo-body text-foreground leading-relaxed whitespace-pre-wrap break-words">{model.context}</p>
        </section>
      )}
      {rec && (
        <section>
          <h3 className="typo-label uppercase tracking-wider text-foreground/85">{rec.label}</h3>
          {rec.revealed && rec.text ? (
            <p className="mt-1 typo-body text-foreground leading-relaxed">{rec.text}</p>
          ) : rec.reveal ? (
            <button
              type="button"
              onClick={rec.reveal}
              className="mt-1 inline-flex items-center gap-2 rounded-interactive px-2 py-1 typo-body text-foreground hover:bg-foreground/[0.06] focus-ring"
            >
              <KeyCap color={color}>{S.keyAsk}</KeyCap>
              {S.askAthena}
            </button>
          ) : null}
          {rec.composing && <p className="mt-1 typo-body text-foreground/85">{rec.composing}</p>}
          {rec.failed && <p className="mt-1 typo-body text-status-warning">{rec.failed}</p>}
        </section>
      )}
      {model.choices.some((c) => c.hint) && (
        <ol className="flex flex-col gap-1.5">
          {model.choices.map((c, i) =>
            c.hint ? (
              <li key={c.key} className="flex items-start gap-2 typo-body text-foreground">
                <KeyCap color={toneColor(c, color)}>{i + 1}</KeyCap>
                <span className="min-w-0 break-words">{c.hint}</span>
              </li>
            ) : null,
          )}
        </ol>
      )}
      {model.details && <DetailsReveal details={model.details} />}
    </div>
  );

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {art}
      <div className="relative flex-1 min-h-0" style={{ perspective: 1400 }}>
        {shouldAnimate ? (
          <motion.div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d' }}
            initial={false}
            animate={{ rotateY: turned ? 180 : 0 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }} aria-hidden={turned}>
              {front}
            </div>
            <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }} aria-hidden={!turned}>
              {back}
            </div>
          </motion.div>
        ) : (
          <div className="absolute inset-0">{turned ? back : front}</div>
        )}
      </div>

      <div className="shrink-0 px-6 pb-1 flex items-center justify-between gap-2 min-h-8">
        {hasBack ? (
          <button
            type="button"
            onClick={() => setTurned((v) => !v)}
            aria-pressed={turned}
            className="inline-flex items-center gap-2 rounded-interactive px-2.5 py-1 typo-body text-foreground hover:bg-foreground/[0.06] focus-ring"
          >
            <RotateCw className="w-4 h-4" aria-hidden />
            {turned ? S.hideDetails : S.showDetails}
          </button>
        ) : (
          <span />
        )}
        <span className="typo-body text-foreground/85">{model.waiting > 0 ? S.moreWaiting(model.waiting) : ''}</span>
        <Deferrals model={model} align="end" />
      </div>
    </div>
  );
}
