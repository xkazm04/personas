import { useMemo } from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { N8nQuestionStepper } from '@/features/templates/sub_n8n/widgets/N8nQuestionStepper';
import type { TransformQuestion } from '@/features/templates/sub_n8n/hooks/useN8nImportReducer';
import { cardClass } from './tuneStepConstants';

export function AiQuestionsCard({
  questions,
  userAnswers,
  onAnswerUpdated,
}: {
  questions: TransformQuestion[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  /** @deprecated Skip is no longer exposed — questions are required for quality */
  onSkipQuestions?: () => void;
}) {
  const answeredCount = useMemo(
    () => questions.filter(q => {
      const a = userAnswers[q.id];
      return a !== undefined && a !== '';
    }).length,
    [questions, userAnswers],
  );

  const allAnswered = answeredCount === questions.length;

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-violet-400/70"><Sparkles className="w-4 h-4" /></span>
          <span className="text-sm font-medium text-foreground/70">Customize Your Persona</span>
          <span className="text-sm text-muted-foreground/40">{questions.length} questions</span>
        </div>
        <div className="flex items-center gap-1.5">
          {allAnswered ? (
            <span className="flex items-center gap-1 text-sm text-emerald-400/70">
              <CheckCircle2 className="w-3.5 h-3.5" /> All answered
            </span>
          ) : (
            <span className="text-sm text-amber-400/60">
              {answeredCount}/{questions.length} answered
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground/50 mb-3 leading-relaxed">
        These questions help tailor the persona to your specific needs.
        Answer all questions for the best results — each answer directly shapes persona behavior.
      </p>
      <N8nQuestionStepper
        questions={questions}
        userAnswers={userAnswers}
        onAnswerUpdated={onAnswerUpdated}
      />
    </div>
  );
}
