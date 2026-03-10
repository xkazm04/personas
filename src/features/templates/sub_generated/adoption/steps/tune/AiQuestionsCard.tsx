import { Sparkles } from 'lucide-react';
import { N8nQuestionStepper } from '@/features/templates/sub_n8n/widgets/N8nQuestionStepper';
import type { TransformQuestion } from '@/features/templates/sub_n8n/hooks/useN8nImportReducer';
import { cardClass } from './tuneStepConstants';

export function AiQuestionsCard({
  questions,
  userAnswers,
  onAnswerUpdated,
  onSkipQuestions,
}: {
  questions: TransformQuestion[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSkipQuestions: () => void;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-violet-400/70"><Sparkles className="w-4 h-4" /></span>
          <span className="text-sm font-medium text-foreground/70">AI Configuration</span>
          <span className="text-sm text-muted-foreground/40">{questions.length} questions</span>
        </div>
        <button
          type="button"
          onClick={onSkipQuestions}
          className="text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
        >
          Skip all
        </button>
      </div>
      <N8nQuestionStepper
        questions={questions}
        userAnswers={userAnswers}
        onAnswerUpdated={onAnswerUpdated}
      />
    </div>
  );
}
