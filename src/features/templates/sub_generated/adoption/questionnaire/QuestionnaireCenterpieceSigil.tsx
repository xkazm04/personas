import { useMemo } from 'react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { GlyphDimension } from '@/features/shared/glyph';
import { InteractiveSigil } from '@/features/shared/glyph/InteractiveSigil';
import {
  buildQuestionnaireGlyphRow,
  applyAnswerOverlay,
  QUESTION_CATEGORY_TO_DIM,
} from './questionnaireGlyphRow';

/**
 * Glyph-language centerpiece for the questionnaire. Replaces the planet-orbit
 * decorative background with the same 8-petal sigil used in the matrix and
 * card views — so the user sees the persona's dimensional shape forming as
 * they answer, in the same vocabulary they'll see during the build/test
 * stages later.
 *
 * Two data layers feed the sigil:
 *   1. **Template presets** — base presence from the V3 payload (triggers,
 *      connectors, per-UC review/memory/event policies, persona-level
 *      message/error config).
 *   2. **Live answer overlay** — categories with at least one answered
 *      question bump their mapped petal up one presence rung.
 *
 * The current question's category lights its mapped petal as `activeDim`,
 * giving the sigil a "this is what you're configuring right now" anchor.
 *
 * Decorative-only in the questionnaire — the scroll container above
 * intercepts pointer events, and the category rail already provides
 * jump-to-category navigation. Petal interactivity is reserved for the
 * matrix view (Phase D), where clicking a dimension opens its editor.
 */
const NO_HOVER_HANDLER = (_dim: GlyphDimension | null) => undefined;
const NO_CLICK_HANDLER = (_dim: GlyphDimension) => undefined;

export function QuestionnaireCenterpieceSigil({
  designResult,
  questions,
  userAnswers,
  templateName,
  currentCategory,
  size = 360,
}: {
  designResult: AgentIR | null;
  questions: ReadonlyArray<TransformQuestionResponse>;
  userAnswers: Readonly<Record<string, string>>;
  templateName: string;
  currentCategory: string;
  size?: number;
}) {
  // Build the composite row once per (template, answers) pair. Answer
  // dependencies are the userAnswers values — keying on `questions.length`
  // alone would miss the case where the user answers without changing length.
  const row = useMemo(() => {
    const base = buildQuestionnaireGlyphRow(designResult, templateName);
    return applyAnswerOverlay(base, questions, userAnswers);
  }, [designResult, templateName, questions, userAnswers]);

  // Active petal = the dimension mapped from the current question's category.
  // If the current category has no glyph mapping (e.g. uncategorised), the
  // sigil shows no active petal — that's correct, the question isn't about
  // a dimensional configuration.
  const activeDim: GlyphDimension | null = QUESTION_CATEGORY_TO_DIM[currentCategory] ?? null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none text-foreground"
      aria-hidden="true"
    >
      <div style={{ opacity: 0.4 }}>
        <InteractiveSigil
          row={row}
          rowIndex={0}
          hoveredDim={null}
          activeDim={activeDim}
          onHover={NO_HOVER_HANDLER}
          onClick={NO_CLICK_HANDLER}
          size={size}
        />
      </div>
    </div>
  );
}
