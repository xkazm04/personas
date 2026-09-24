/**
 * Spread · Oracle — the question IS the card. It sits in the centre of the
 * face as the card's inscription; the answers hang below it as full-width
 * engraved plates with their number keys; Athena's recommendation marks its
 * plate with a seal once asked for (`0` or "Ask Athena"). Context reads as a
 * quiet line under the question. No inner card, no header band.
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import { Sparkles } from 'lucide-react';
import { mix } from '../cardArt';
import { SPREAD_COPY as S } from '../copy';
import type { BodyProps } from './CardBody';
import { ChoiceButton, DetailsReveal, FieldInput, FieldSubmit, KeyCap, Problems, toneColor } from './parts';

export function OracleBody({ model, color, art }: BodyProps) {
  const rec = model.recommendation;
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {art}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 pt-4 pb-2 flex flex-col gap-4">
        <div className="text-center flex flex-col items-center gap-2">
          <p className="typo-label uppercase tracking-[0.18em]" style={{ color: mix(color, 85, 'var(--foreground)') }}>
            {model.eyebrow}
          </p>
          <h2 className="typo-heading-lg text-foreground leading-snug text-balance break-words">{model.question}</h2>
          {model.context && <p className="typo-body text-foreground/85 leading-relaxed max-w-prose">{model.context}</p>}
          <span className="mt-1 h-px w-24" style={{ background: `linear-gradient(90deg, transparent, ${mix(color, 70)}, transparent)` }} aria-hidden />
        </div>

        {model.choices.length > 0 && (
          <ol className="flex flex-col gap-2">
            {model.choices.map((c, i) => {
              const tone = toneColor(c, color);
              return (
                <li key={c.key}>
                  <ChoiceButton
                    choice={c}
                    block
                    className="justify-start text-left border"
                    style={{
                      borderColor: c.recommended ? tone : mix(tone, 40),
                      background: c.recommended
                        ? `linear-gradient(90deg, ${mix(tone, 26, 'var(--background)')}, ${mix(tone, 10, 'var(--background)')})`
                        : mix(tone, 8, 'var(--background)'),
                      boxShadow: c.recommended ? `inset 0 0 0 1px ${mix(tone, 50)}, 0 0 22px -8px ${tone}` : `inset 0 1px 0 ${mix('var(--foreground)', 8)}`,
                    }}
                  >
                    <span className="flex items-center gap-3 w-full min-w-0">
                      <KeyCap color={tone}>{i + 1}</KeyCap>
                      <span className="flex-1 min-w-0 flex flex-col">
                        <span className="typo-body-lg text-foreground whitespace-normal break-words">{c.label}</span>
                        {c.hint && <span className="typo-body text-foreground/85 whitespace-normal">{c.hint}</span>}
                      </span>
                      {c.recommended && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 typo-label uppercase tracking-wider text-foreground" style={{ borderColor: tone }}>
                          <Sparkles className="w-3 h-3" aria-hidden />
                          {S.recommended}
                        </span>
                      )}
                    </span>
                  </ChoiceButton>
                </li>
              );
            })}
          </ol>
        )}

        {model.field && (
          <div className="flex flex-col gap-2">
            <FieldInput field={model.field} />
            {model.field.submit && (
              <div className="flex justify-end">
                <FieldSubmit field={model.field} />
              </div>
            )}
          </div>
        )}

        {rec && (
          <div className="text-center">
            {rec.revealed && rec.text ? (
              <p className="typo-body text-foreground leading-relaxed">
                <span className="typo-label uppercase tracking-wider mr-2" style={{ color: mix(color, 85, 'var(--foreground)') }}>
                  {rec.label}
                </span>
                {rec.text}
              </p>
            ) : rec.reveal ? (
              <button
                type="button"
                onClick={rec.reveal}
                className="inline-flex items-center gap-2 rounded-interactive px-3 py-1.5 typo-body text-foreground hover:bg-foreground/[0.06] focus-ring"
              >
                <KeyCap color={color}>{S.keyAsk}</KeyCap>
                {S.askAthena}
              </button>
            ) : null}
            {rec.composing && <p className="mt-1 typo-body text-foreground/85">{rec.composing}</p>}
            {rec.failed && <p className="mt-1 typo-body text-status-warning">{rec.failed}</p>}
          </div>
        )}

        {model.details && <DetailsReveal details={model.details} />}
        <Problems model={model} />
      </div>

    </div>
  );
}
