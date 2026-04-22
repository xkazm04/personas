import { motion } from 'framer-motion';
import { Sparkles, AlertCircle } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Unified top band: template identity on the left, live counters on the
 * right, variable-width coloured-bar stepper below. The stepper is a
 * secondary nav — each pill is clickable and tells the user at a glance
 * which questions are answered, current, unanswered, or blocked.
 */
export function QuestionnaireHeaderBand({
  templateName,
  questions,
  userAnswers,
  blockedQuestionIds,
  activeIdx,
  answeredCount,
  totalCount,
  blockedCount,
  progressPct,
  onJumpTo,
}: {
  templateName?: string;
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  blockedQuestionIds?: Set<string>;
  activeIdx: number;
  answeredCount: number;
  totalCount: number;
  blockedCount: number;
  progressPct: number;
  onJumpTo: (idx: number) => void;
}) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
      <div className="flex items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border border-primary/30"
              animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-base font-semibold text-foreground truncate">
              {templateName ?? t.templates.adopt_modal.untitled_agent}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-foreground/60">
              {t.templates.adopt_modal.configure_your_persona}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm text-foreground tabular-nums">
          <span>
            {tx(t.templates.adopt_modal.answered_of_total, {
              answered: answeredCount,
              total: totalCount,
            })}
          </span>
          {blockedCount > 0 && (
            <span className="text-status-error/80 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              {tx(t.templates.adopt_modal.blocked_count, { count: blockedCount })}
            </span>
          )}
          <span className="text-base font-semibold text-primary">
            {Math.round(progressPct * 100)}%
          </span>
        </div>
      </div>

      {/* Coloured-bar stepper */}
      <div className="px-5 pb-3 flex items-center justify-center gap-1 flex-wrap">
        {questions.map((q, i) => {
          const isActive = i === activeIdx;
          const isAnswered = !!userAnswers[q.id];
          const isBlocked = blockedQuestionIds?.has(q.id);
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onJumpTo(i)}
              title={q.question}
              className={`flex-shrink-0 h-1.5 rounded-full transition-all ${
                isActive
                  ? 'w-10 bg-primary'
                  : isBlocked
                    ? 'w-3 bg-status-error/60'
                    : isAnswered
                      ? 'w-5 bg-status-success/60 hover:bg-status-success'
                      : 'w-3 bg-foreground/[0.12] hover:bg-foreground/[0.2]'
              }`}
              aria-label={tx(t.templates.adopt_modal.question_number_aria, { number: i + 1 })}
            />
          );
        })}
      </div>
    </div>
  );
}
