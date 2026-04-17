import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, KeyRound, Settings2, ShieldCheck, Brain, Bell } from 'lucide-react';
import { N8nQuestionListbox } from './N8nQuestionListbox';
import type { TransformQuestion } from '../hooks/useN8nImportReducer';

const DIMENSION_LABELS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound },
  configuration:     { label: 'Configuration',     Icon: Settings2 },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck },
  memory:            { label: 'Memory & Learning',  Icon: Brain },
  notifications:     { label: 'Notifications',      Icon: Bell },
};

const CARD_TONES = [
  { border: 'border-violet-500/20', bg: 'bg-violet-500/[0.06]', accent: 'text-violet-300', dot: 'bg-violet-400', selectBg: 'bg-violet-500/15 text-violet-300 border-violet-500/25' },
  { border: 'border-blue-500/20', bg: 'bg-blue-500/[0.06]', accent: 'text-blue-300', dot: 'bg-blue-400', selectBg: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  { border: 'border-cyan-500/20', bg: 'bg-cyan-500/[0.06]', accent: 'text-cyan-300', dot: 'bg-cyan-400', selectBg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' },
  { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.06]', accent: 'text-emerald-300', dot: 'bg-emerald-400', selectBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
  { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.06]', accent: 'text-amber-300', dot: 'bg-amber-400', selectBg: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  { border: 'border-rose-500/20', bg: 'bg-rose-500/[0.06]', accent: 'text-rose-300', dot: 'bg-rose-400', selectBg: 'bg-rose-500/15 text-rose-300 border-rose-500/25' },
] as const;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

interface Props {
  questions: TransformQuestion[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
}

export function N8nQuestionStepper({ questions, userAnswers, onAnswerUpdated }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < questions.length - 1;

  const goTo = useCallback((index: number) => {
    setActiveIndex((prev) => {
      if (index < 0 || index >= questions.length || index === prev) return prev;
      setDirection(index > prev ? 1 : -1);
      return index;
    });
  }, [questions.length]);

  const goPrev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);
  const goNext = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);

  // Keyboard: left/right arrows (skip when typing in inputs)
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
  const dim = q.category ? DIMENSION_LABELS[q.category] : undefined;

  return (
    <div className="flex flex-col items-center">
      {/* Card area with nav arrows */}
      <div className="flex items-center gap-3 w-full">
        {/* Left arrow */}
        <button
          onClick={goPrev}
          disabled={!canPrev}
          className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
            canPrev
              ? 'border-primary/20 hover:bg-secondary/50 text-foreground hover:text-foreground'
              : 'border-primary/5 text-foreground cursor-default'
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
              style={{ minHeight: 250 }}
              className={`p-4 rounded-modal border ${tone.border} ${tone.bg}`}
            >
              {/* Category + counter */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {dim && <dim.Icon className={`w-4 h-4 ${tone.accent}`} />}
                  {dim && (
                    <span className={`typo-heading font-semibold uppercase tracking-wider ${tone.accent}`}>
                      {dim.label}
                    </span>
                  )}
                </div>
                <span className="typo-data text-foreground tabular-nums">
                  {activeIndex + 1} / {questions.length}
                </span>
              </div>

              {/* Question text */}
              <p className="typo-body-lg font-medium text-foreground/90 leading-relaxed mb-1">
                {q.question}
              </p>

              {q.context && (
                <p className="typo-body text-foreground mb-4 leading-relaxed">
                  {q.context}
                </p>
              )}

              {/* Input */}
              <div className="mt-3">
                {q.type === 'select' && q.options && (
                  <N8nQuestionListbox
                    options={q.options}
                    value={userAnswers[q.id] ?? q.default ?? ''}
                    onChange={(val) => onAnswerUpdated(q.id, val)}
                    selectedClassName={tone.selectBg}
                  />
                )}

                {q.type === 'text' && (
                  <input
                    type="text"
                    value={userAnswers[q.id] ?? q.default ?? ''}
                    onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                    placeholder={q.default ?? 'Type your answer\u2026'}
                    className="w-full px-4 py-2.5 typo-body rounded-modal border border-primary/15 bg-background/60 text-foreground placeholder-muted-foreground/40 focus-ring focus-visible:border-primary/30 transition-all"
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
                          className={`px-4 py-2 typo-body rounded-modal border transition-all ${
                            isSelected
                              ? `${tone.selectBg} font-medium`
                              : 'text-foreground border-primary/10 hover:bg-secondary/40'
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
              ? 'border-primary/20 hover:bg-secondary/50 text-foreground hover:text-foreground'
              : 'border-primary/5 text-foreground cursor-default'
          }`}
          aria-label="Next question"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mt-4">
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

      {/* Keyboard hint */}
      <p className="typo-body text-foreground mt-2">
        Use{' '}
        <kbd className="px-1 py-0.5 rounded bg-secondary/40 border border-primary/8 typo-code font-mono">&larr;</kbd>
        {' '}
        <kbd className="px-1 py-0.5 rounded bg-secondary/40 border border-primary/8 typo-code font-mono">&rarr;</kbd>
        {' '}to navigate
      </p>
    </div>
  );
}
