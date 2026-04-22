import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { GlyphRow } from './types';
import { GlyphCard } from './GlyphCard';
import { GlyphQuestionPanel } from './GlyphQuestionPanel';

interface GlyphGridProps {
  rows: GlyphRow[];
  flowsById?: Map<string, UseCaseFlow>;
  templateName?: string;
  /** Grid column breakpoint. `2` (default) = 1-col mobile, 2-col xl+. `1` = always single. */
  columns?: 1 | 2;
  /** Override for the empty-state label (falls back to i18n empty_seeding). */
  emptyLabel?: string;
  /** Mid-build questions to surface as an inline Q&A panel above the grid. */
  pendingQuestions?: BuildQuestion[];
  /** Called when the user submits an answer to one of the pending questions. */
  onAnswerBuildQuestion?: (cellKey: string, answer: string) => void;
  /** Optional slot rendered above the grid — used by edit-mode in pre-build
   *  to host DimensionQuickConfig (trigger / connector / event preconfig). */
  slotAbove?: ReactNode;
}

/** Stateless grid of Glyph capability cards. All four surfaces — adoption,
 *  edit, view, template preview — share this layout and only differ in how
 *  they source `rows`, pending questions, and the pre-build config slot. */
export function GlyphGrid({
  rows, flowsById, templateName, columns = 2, emptyLabel,
  pendingQuestions, onAnswerBuildQuestion, slotAbove,
}: GlyphGridProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const questions = pendingQuestions ?? [];
  const hasQuestions = questions.length > 0 && !!onAnswerBuildQuestion;

  const gridCls = columns === 1 ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 xl:grid-cols-2 gap-3';

  return (
    <div className="flex flex-col gap-3">
      {slotAbove}
      {hasQuestions && (
        <GlyphQuestionPanel questions={questions} onAnswer={onAnswerBuildQuestion!} />
      )}
      {rows.length === 0 ? (
        <div className="rounded-modal bg-card-bg border border-card-border p-8 text-center shadow-elevation-2">
          <span className="typo-body text-foreground/75 italic">
            {emptyLabel ?? c.empty_seeding}
          </span>
        </div>
      ) : (
        <div className={gridCls}>
          {rows.map((row, i) => (
            <GlyphCard
              key={row.id}
              row={row}
              index={i}
              flow={flowsById?.get(row.id) ?? null}
              templateName={templateName}
            />
          ))}
        </div>
      )}
    </div>
  );
}
