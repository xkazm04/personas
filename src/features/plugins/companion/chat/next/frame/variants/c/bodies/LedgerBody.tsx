/**
 * Spread · Ledger — the card as a two-zone sheet. Above the rule: the
 * question as the entry's heading, then ruled lines (context, Athena's
 * recommendation, the machine detail) with a seal in the margin. Below the
 * rule: a compact verdict row, every verb on one line at the card's foot,
 * with the note / answer field right above it. Reading and deciding never
 * share a zone.
 *
 * TODO(prototype, 2026-09-24): consolidate the Athena chat switcher.
 */

import type { ReactNode } from 'react';
import { KIND_GLYPH, mix } from '../cardArt';
import { SPREAD_COPY as S } from '../copy';
import type { BodyProps } from './CardBody';
import { ChoiceButton, Deferrals, DetailsReveal, FieldInput, FieldSubmit, KeyCap, Problems, toneColor } from './parts';

function Line({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3 py-2.5 border-b border-dashed" style={{ borderColor: mix('var(--foreground)', 14) }}>
      <span className="typo-label uppercase tracking-wider pt-0.5" style={{ color: mix(color, 85, 'var(--foreground)') }}>
        {label}
      </span>
      <div className="min-w-0 typo-body text-foreground leading-relaxed break-words">{children}</div>
    </div>
  );
}

export function LedgerBody({ model, color, item }: BodyProps) {
  const rec = model.recommendation;
  const Glyph = KIND_GLYPH[item.kind];
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* Zone one: the entry. */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-6 pt-6 pb-3">
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 grid place-items-center w-11 h-11 rounded-full border-2"
            style={{ borderColor: color, background: mix(color, 16, 'var(--background)'), boxShadow: `0 0 18px -6px ${color}` }}
            aria-hidden
          >
            <Glyph className="w-5 h-5 text-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="typo-label uppercase tracking-wider text-foreground/85">{model.eyebrow}</p>
            <h2 className="mt-1 typo-section-title text-foreground leading-snug break-words">{model.question}</h2>
          </div>
        </div>

        <div className="mt-3">
          {model.context && (
            <Line label={S.context} color={color}>
              <p className="whitespace-pre-wrap">{model.context}</p>
            </Line>
          )}
          {rec && (rec.revealed || rec.reveal || rec.composing || rec.failed) && (
            <Line label={S.why} color={color}>
              {rec.revealed && rec.text ? (
                <p>{rec.text}</p>
              ) : rec.reveal ? (
                <button
                  type="button"
                  onClick={rec.reveal}
                  className="inline-flex items-center gap-2 rounded-interactive -mx-1 px-1 py-0.5 typo-body text-foreground underline decoration-dotted underline-offset-4 hover:bg-foreground/[0.06] focus-ring"
                >
                  <KeyCap color={color}>{S.keyAsk}</KeyCap>
                  {S.askAthena}
                </button>
              ) : null}
              {rec.composing && <p className="mt-1 text-foreground/85">{rec.composing}</p>}
              {rec.failed && <p className="mt-1 text-status-warning">{rec.failed}</p>}
            </Line>
          )}
          {model.details && (
            <Line label={S.details} color={color}>
              <DetailsReveal details={model.details} />
            </Line>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Problems model={model} />
        </div>
      </div>

      {/* The rule between reading and deciding. */}
      <div className="shrink-0 mx-6 flex items-center gap-3" aria-hidden>
        <span className="flex-1 h-[3px] border-y" style={{ borderColor: mix(color, 55) }} />
        <span className="typo-label uppercase tracking-[0.2em]" style={{ color: mix(color, 85, 'var(--foreground)') }}>
          {S.verdict}
        </span>
        <span className="flex-1 h-[3px] border-y" style={{ borderColor: mix(color, 55) }} />
      </div>

      {/* Zone two: the verdict row. */}
      <div className="shrink-0 px-6 pt-3 pb-1 flex flex-col gap-2.5">
        {model.field && <FieldInput field={model.field} />}
        <div className="flex flex-wrap items-center gap-2">
          {model.choices.map((c, i) => {
            const tone = toneColor(c, color);
            return (
              <ChoiceButton
                key={c.key}
                choice={c}
                size="md"
                className="border"
                style={{
                  borderColor: c.recommended ? tone : mix(tone, 45),
                  background: c.recommended ? mix(tone, 30, 'var(--background)') : mix(tone, 10, 'var(--background)'),
                }}
              >
                <span className="flex items-center gap-2">
                  <KeyCap color={tone}>{i + 1}</KeyCap>
                  <span className="typo-body text-foreground whitespace-normal text-left">{c.label}</span>
                </span>
              </ChoiceButton>
            );
          })}
          {model.field?.submit && <FieldSubmit field={model.field} />}
          <span className="flex-1" />
          {model.waiting > 0 && <span className="typo-body text-foreground/85">{S.moreWaiting(model.waiting)}</span>}
          <Deferrals model={model} align="end" />
        </div>
      </div>
    </div>
  );
}
