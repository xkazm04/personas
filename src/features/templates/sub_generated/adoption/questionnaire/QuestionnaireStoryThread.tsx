import { Check, CircleDot, AlertCircle, ArrowRight, BookOpen } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';
import { CATEGORY_META, FALLBACK_CATEGORY } from '../QuestionnaireFormGridConfig';
import { summarizeAnswer } from './questionnaireHelpers';
import type { QuestionnaireThreadState } from './types';

function statusIconFor(state: QuestionnaireThreadState) {
  if (state === 'answered') return Check;
  if (state === 'current') return ArrowRight;
  if (state === 'blocked') return AlertCircle;
  return CircleDot;
}

function statusColorFor(state: QuestionnaireThreadState) {
  if (state === 'answered') return 'text-status-success';
  if (state === 'current') return 'text-primary';
  if (state === 'blocked') return 'text-status-error';
  return 'text-status-warning/70';
}

function ThreadItem({
  question,
  answer,
  state,
  isAuto,
  onClick,
}: {
  question: TransformQuestionResponse;
  answer: string;
  state: QuestionnaireThreadState;
  isAuto: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const meta = CATEGORY_META[question.category ?? ''] ?? FALLBACK_CATEGORY;
  const StatusIcon = statusIconFor(state);
  const statusColor = statusColorFor(state);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-card px-3 py-2.5 transition-colors group relative ${
        state === 'current'
          ? 'bg-primary/10 border border-primary/25'
          : 'hover:bg-foreground/[0.04] border border-transparent'
      }`}
    >
      {state === 'current' && (
        <span
          aria-hidden
          className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${meta.color} bg-current`}
        />
      )}
      <div className="flex items-start gap-2.5">
        <StatusIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${statusColor}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-foreground leading-snug line-clamp-2">
            {question.question}
          </div>
          {state === 'answered' && answer ? (
            <div className="text-xs text-foreground/65 leading-tight mt-1 truncate italic">
              {summarizeAnswer(answer, question.type, t)}
              {isAuto && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-brand-purple/80 font-semibold not-italic">
                  auto
                </span>
              )}
            </div>
          ) : state === 'current' ? (
            <div className="text-xs uppercase tracking-[0.18em] text-primary/80 font-semibold mt-1">
              current
            </div>
          ) : state === 'blocked' ? (
            <div className="text-xs text-status-error/80 leading-tight mt-1">
              credential needed
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/**
 * Right rail — "story so far" thread. Every question renders as a chip with
 * its thread state (answered / current / pending / blocked), grouped by
 * category with a chapter divider at every category transition. Clicking
 * any chip jumps the hero to that question.
 */
export function QuestionnaireStoryThread({
  questions,
  userAnswers,
  activeIdx,
  autoDetectedIds,
  blockedQuestionIds,
  answeredCount,
  totalCount,
  onJumpTo,
}: {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  activeIdx: number;
  autoDetectedIds?: Set<string>;
  blockedQuestionIds?: Set<string>;
  answeredCount: number;
  totalCount: number;
  onJumpTo: (idx: number) => void;
}) {
  const resolveState = (i: number): QuestionnaireThreadState => {
    const q = questions[i]!;
    if (blockedQuestionIds?.has(q.id)) return 'blocked';
    if (i === activeIdx) return 'current';
    if (userAnswers[q.id]) return 'answered';
    return 'pending';
  };

  return (
    <aside className="w-[320px] flex-shrink-0 border-l border-border bg-foreground/[0.01] flex flex-col min-h-0">
      <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary/70" />
        <span className="text-xs uppercase tracking-[0.2em] text-foreground/60 font-semibold">
          Story so far
        </span>
        <span className="ml-auto text-sm text-foreground/60 tabular-nums">
          {answeredCount}/{totalCount}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {questions.map((q, i) => {
          const prevCat = i > 0 ? questions[i - 1]!.category ?? '__other__' : null;
          const thisCat = q.category ?? '__other__';
          const showChapter = prevCat !== thisCat;
          const meta = CATEGORY_META[thisCat] ?? FALLBACK_CATEGORY;
          return (
            <div key={q.id}>
              {showChapter && (
                <div className="flex items-center gap-2 px-1 pt-3 pb-1.5">
                  <meta.Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                  <span className={`text-xs uppercase tracking-[0.18em] font-semibold ${meta.color}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <ThreadItem
                question={q}
                answer={userAnswers[q.id] ?? ''}
                state={resolveState(i)}
                isAuto={!!autoDetectedIds?.has(q.id)}
                onClick={() => onJumpTo(i)}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
