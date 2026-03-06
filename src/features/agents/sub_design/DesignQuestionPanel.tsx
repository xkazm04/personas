import { useEffect, useRef, useState } from 'react';
import { Send, MessageCircleQuestion } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransformProgress } from '@/features/shared/components/TransformProgress';

export interface DesignQuestion {
  question: string;
  context?: string;
  options?: string[];
}

export interface DesignQuestionPanelProps {
  outputLines: string[];
  question: DesignQuestion;
  onAnswerQuestion: (answer: string) => void;
  onCancelAnalysis: () => void;
}

export function DesignQuestionPanel({
  outputLines,
  question,
  onAnswerQuestion,
  onCancelAnalysis,
}: DesignQuestionPanelProps) {
  const [questionAnswer, setQuestionAnswer] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [question.question]);

  useEffect(() => {
    const options = question.options ?? [];
    if (options.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const idx = Number(event.key) - 1;
      if (idx >= 0 && idx < Math.min(4, options.length)) {
        event.preventDefault();
        setQuestionAnswer('');
        onAnswerQuestion(options[idx]!);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [question.options, onAnswerQuestion]);

  return (
    <motion.div
      key="awaiting-input"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="space-y-4"
    >
      {/* Terminal output so far */}
      <TransformProgress mode="analysis" lines={outputLines} isRunning={false} />

      {/* Question card */}
      <div className="bg-gradient-to-br from-accent/10 via-primary/5 to-transparent border border-accent/25 rounded-[var(--radius-interactive)] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-[var(--radius-secondary)] bg-accent/10 border border-accent/25 flex items-center justify-center">
            <MessageCircleQuestion className="w-4 h-4 text-accent" />
          </div>
          <span className="text-sm font-semibold text-accent">Clarification Needed</span>
        </div>

        <p className="text-sm text-foreground/80 leading-relaxed">{question.question}</p>

        {question.context && (
          <p className="text-sm text-muted-foreground/90 italic border-l-2 border-accent/25 pl-3">
            {question.context}
          </p>
        )}

        {/* Option buttons */}
        {question.options && question.options.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {question.options.map((option, i) => (
              <button
                key={i}
                onClick={() => {
                  setQuestionAnswer('');
                  onAnswerQuestion(option);
                }}
                className="px-3.5 py-2 rounded-[var(--radius-secondary)] text-sm font-medium bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20 hover:border-accent/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <span>{option}</span>
                {i < 4 && (
                  <span className="ml-2 text-sm border border-accent/30 rounded px-1 text-accent/70">{i + 1}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex-1 h-px bg-primary/10" />
          <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">or type your answer</span>
          <div className="flex-1 h-px bg-primary/10" />
        </div>

        {/* Free-text input */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={questionAnswer}
            onChange={(e) => setQuestionAnswer(e.target.value)}
            placeholder="Type a custom answer..."
            className="flex-1 min-h-[48px] max-h-[100px] bg-background/50 border border-primary/15 rounded-[var(--radius-interactive)] px-3 py-2 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/30 transition-all placeholder-muted-foreground/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                if (questionAnswer.trim()) {
                  onAnswerQuestion(questionAnswer.trim());
                  setQuestionAnswer('');
                }
              }
            }}
          />
          <button
            onClick={() => {
              if (questionAnswer.trim()) {
                onAnswerQuestion(questionAnswer.trim());
                setQuestionAnswer('');
              }
            }}
            disabled={!questionAnswer.trim()}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
              !questionAnswer.trim()
                ? 'bg-secondary/40 text-muted-foreground/80 cursor-not-allowed'
                : 'bg-accent/15 text-accent border border-accent/25 hover:bg-accent/25'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            Answer
          </button>
        </div>
        <p className="text-sm text-muted-foreground">Ctrl+Enter to submit</p>
      </div>

      {/* Cancel */}
      <button
        onClick={onCancelAnalysis}
        className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-muted-foreground/90 hover:text-foreground/95 transition-colors"
      >
        Cancel Design
      </button>
    </motion.div>
  );
}
