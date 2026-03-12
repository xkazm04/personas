/**
 * BuildQuestionnaireModal -- portal-based questionnaire for CLI-generated
 * questions during persona build. Renders one question at a time with
 * card-based carousel animation, adapted from N8nQuestionStepper.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X, Send,
  KeyRound, Settings2, ShieldCheck, Brain, Bell, HelpCircle,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

const CATEGORY_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound },
  configuration:     { label: 'Configuration',     Icon: Settings2 },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck },
  memory:            { label: 'Memory & Learning',  Icon: Brain },
  notifications:     { label: 'Notifications',      Icon: Bell },
};

const CARD_TONES = [
  { border: 'border-violet-500/20', bg: 'bg-violet-500/[0.06]', accent: 'text-violet-500 dark:text-violet-300', dot: 'bg-violet-400', selectBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/25' },
  { border: 'border-blue-500/20', bg: 'bg-blue-500/[0.06]', accent: 'text-blue-500 dark:text-blue-300', dot: 'bg-blue-400', selectBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/25' },
  { border: 'border-cyan-500/20', bg: 'bg-cyan-500/[0.06]', accent: 'text-cyan-600 dark:text-cyan-300', dot: 'bg-cyan-400', selectBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/25' },
  { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.06]', accent: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-400', selectBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/25' },
  { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.06]', accent: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-400', selectBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/25' },
  { border: 'border-rose-500/20', bg: 'bg-rose-500/[0.06]', accent: 'text-rose-500 dark:text-rose-300', dot: 'bg-rose-400', selectBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/25' },
] as const;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

interface BuildQuestionnaireModalProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BuildQuestionnaireModal({
  questions,
  userAnswers,
  onAnswerUpdated,
  onSubmit,
  onClose,
}: BuildQuestionnaireModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < questions.length - 1;
  const isLast = activeIndex === questions.length - 1;

  const goTo = useCallback((index: number) => {
    setActiveIndex((prev) => {
      if (index < 0 || index >= questions.length || index === prev) return prev;
      setDirection(index > prev ? 1 : -1);
      return index;
    });
  }, [questions.length]);

  const goPrev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);
  const goNext = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext]);

  const q = questions[activeIndex]!;
  const tone = CARD_TONES[activeIndex % CARD_TONES.length]!;
  const dim = q.category ? CATEGORY_META[q.category] : undefined;

  const allAnswered = questions.every((qn) => {
    const val = userAnswers[qn.id];
    return val !== undefined && val !== '';
  });

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="w-full max-w-xl bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-4.5 h-4.5 text-primary" />
            <h3 className="text-base font-semibold text-foreground/90">Setup Questions</h3>
            <span className="text-sm text-muted-foreground/50 tabular-nums">{activeIndex + 1} / {questions.length}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-foreground/[0.04] transition-colors">
            <X className="w-4 h-4 text-muted-foreground/60" />
          </button>
        </div>

        {/* Card area */}
        <div className="flex items-center gap-3 p-5">
          {/* Left arrow */}
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
              canPrev
                ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70 hover:text-foreground'
                : 'border-primary/5 text-foreground/15 cursor-default'
            }`}
            aria-label="Previous question"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Card */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={activeIndex}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                style={{ minHeight: 200 }}
                className={`p-4 rounded-xl border ${tone.border} ${tone.bg}`}
              >
                {/* Category */}
                {dim && (
                  <div className="flex items-center gap-2 mb-3">
                    <dim.Icon className={`w-4 h-4 ${tone.accent}`} />
                    <span className={`text-sm font-semibold uppercase tracking-wider ${tone.accent}`}>
                      {dim.label}
                    </span>
                  </div>
                )}

                {/* Question text */}
                <p className="text-base font-medium text-foreground/90 leading-relaxed mb-1">
                  {q.question}
                </p>
                {q.context && (
                  <p className="text-sm text-foreground/50 mb-4 leading-relaxed">{q.context}</p>
                )}

                {/* Input */}
                <div className="mt-3">
                  {q.type === 'select' && q.options && (
                    <div className="space-y-1.5">
                      {q.options.map((opt) => {
                        const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => onAnswerUpdated(q.id, opt)}
                            className={`w-full text-left px-3 py-2 text-sm rounded-lg border transition-all ${
                              isSelected
                                ? `${tone.selectBg} font-medium`
                                : 'text-foreground/70 border-primary/10 hover:bg-secondary/40'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {q.type === 'text' && (
                    <input
                      type="text"
                      value={userAnswers[q.id] ?? q.default ?? ''}
                      onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                      placeholder={q.default ?? 'Type your answer...'}
                      className="w-full px-4 py-2.5 text-sm rounded-xl border border-primary/15 bg-background/60 text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/30 transition-all"
                    />
                  )}

                  {q.type === 'boolean' && (
                    <div className="flex gap-3">
                      {(q.options ?? ['Yes', 'No']).map((opt) => {
                        const isSelected = (userAnswers[q.id] ?? q.default ?? '') === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => onAnswerUpdated(q.id, opt)}
                            className={`px-4 py-2 text-sm rounded-xl border transition-all ${
                              isSelected
                                ? `${tone.selectBg} font-medium`
                                : 'text-foreground/70 border-primary/10 hover:bg-secondary/40'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right arrow */}
          <button
            onClick={goNext}
            disabled={!canNext}
            className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
              canNext
                ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70 hover:text-foreground'
                : 'border-primary/5 text-foreground/15 cursor-default'
            }`}
            aria-label="Next question"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 px-5">
          {questions.map((_, i) => {
            const dotTone = CARD_TONES[i % CARD_TONES.length]!;
            const isActive = i === activeIndex;
            const isAnswered = !!userAnswers[questions[i]!.id];
            return (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className={`rounded-full transition-all duration-200 ${
                  isActive
                    ? `w-6 h-2 ${dotTone.dot}`
                    : isAnswered
                      ? `w-2 h-2 ${dotTone.dot} opacity-50`
                      : 'w-2 h-2 bg-foreground/15'
                }`}
                aria-label={`Go to question ${i + 1}`}
              />
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-primary/10 mt-3">
          <p className="text-xs text-muted-foreground/40">
            Use <kbd className="px-1 py-0.5 rounded bg-secondary/40 border border-primary/8 text-xs font-mono">&larr;</kbd>{' '}
            <kbd className="px-1 py-0.5 rounded bg-secondary/40 border border-primary/8 text-xs font-mono">&rarr;</kbd>{' '}to navigate
          </p>
          <button
            type="button"
            onClick={isLast ? onSubmit : goNext}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              isLast
                ? allAnswered
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-primary/50 text-primary-foreground/70 cursor-not-allowed'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
            disabled={isLast && !allAnswered}
          >
            {isLast ? (
              <>Submit Answers <Send className="w-3.5 h-3.5" /></>
            ) : (
              <>Next <ChevronRight className="w-3.5 h-3.5" /></>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
