/**
 * BuildQuestionnaireModal -- questionnaire carousel for adoption questions.
 * One question at a time with animated card transitions, category badges,
 * and support for select, text, boolean, and devtools_project input types.
 *
 * Renders as a headerless overlay panel — the parent modal provides the header
 * with step name and progress. Unanswered mandatory questions are highlighted
 * in the progress dots with a pulsing ring.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X, Send, Check, Info,
  KeyRound, Settings2, ShieldCheck, Brain, Bell,
  Globe, Gauge, SkipForward,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { DevToolsProjectDropdown } from '@/features/shared/components/forms/DevToolsProjectDropdown';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

const CATEGORY_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound },
  configuration:     { label: 'Configuration',     Icon: Settings2 },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck },
  memory:            { label: 'Memory & Learning',  Icon: Brain },
  notifications:     { label: 'Notifications',      Icon: Bell },
  domain:            { label: 'Domain',             Icon: Globe },
  quality:           { label: 'Quality',            Icon: Gauge },
};

const CARD_TONES = [
  { border: 'border-violet-500/20', bg: 'bg-violet-500/[0.06]', accent: 'text-violet-500 dark:text-violet-300', dot: 'bg-violet-400', selectBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
  { border: 'border-blue-500/20', bg: 'bg-blue-500/[0.06]', accent: 'text-blue-500 dark:text-blue-300', dot: 'bg-blue-400', selectBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
  { border: 'border-cyan-500/20', bg: 'bg-cyan-500/[0.06]', accent: 'text-cyan-600 dark:text-cyan-300', dot: 'bg-cyan-400', selectBg: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
  { border: 'border-emerald-500/20', bg: 'bg-emerald-500/[0.06]', accent: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-400', selectBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
  { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.06]', accent: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-400', selectBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
  { border: 'border-rose-500/20', bg: 'bg-rose-500/[0.06]', accent: 'text-rose-500 dark:text-rose-300', dot: 'bg-rose-400', selectBg: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/25', inputRing: 'focus:outline-none focus-visible:ring-0 focus-visible:border-primary/15' },
] as const;

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 50 : -50, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -50 : 50, opacity: 0 }),
};

/** Fixed card height so every question has the same visual footprint. */
const CARD_HEIGHT = 400;

interface BuildQuestionnaireModalProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** Normalize boolean defaults — templates may use true/false instead of "Yes"/"No". */
function normalizeBooleanDefault(val: unknown): string {
  if (val === true || val === 'true' || val === 'yes' || val === 'Yes') return 'Yes';
  if (val === false || val === 'false' || val === 'no' || val === 'No') return 'No';
  return typeof val === 'string' ? val : '';
}

export function BuildQuestionnaireModal({
  questions,
  userAnswers,
  onAnswerUpdated,
  onSubmit,
  onClose,
}: BuildQuestionnaireModalProps) {
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

  // Keyboard: ArrowLeft/Right to navigate, Enter to advance/submit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // Allow Enter in text inputs when field is not empty
      if (e.key === 'Enter' && isInput) {
        const val = (e.target as HTMLInputElement)?.value?.trim();
        if (val) { e.preventDefault(); if (isLast) { onSubmit(); } else { goNext(); } }
        return;
      }
      if (isInput) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'Enter') { e.preventDefault(); if (isLast) { onSubmit(); } else { goNext(); } }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext, isLast, onSubmit]);

  const q = questions[activeIndex]!;
  const tone = CARD_TONES[activeIndex % CARD_TONES.length]!;
  const dim = q.category ? CATEGORY_META[q.category] : undefined;

  const answeredCount = questions.filter((qn) => {
    const val = userAnswers[qn.id];
    return val !== undefined && val !== '';
  }).length;
  const allAnswered = answeredCount === questions.length;

  // Resolve the current answer, handling boolean defaults
  const currentAnswer = q.type === 'boolean'
    ? (userAnswers[q.id] ?? normalizeBooleanDefault(q.default) ?? '')
    : (userAnswers[q.id] ?? q.default ?? '');

  // Find first unanswered question index (for submit-disabled navigation hint)
  const firstUnansweredIndex = questions.findIndex((qn) => {
    const val = userAnswers[qn.id];
    return val === undefined || val === '';
  });

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="build-questionnaire-title"
      containerClassName="fixed inset-0 z-[200] flex items-center justify-center p-4"
      size="lg"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden w-full max-w-3xl"
    >
      {/* Minimal header — step name only, no icon/title duplication */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-primary/10">
        <h3 id="build-questionnaire-title" className="text-sm font-medium text-foreground/80">
          {dim ? dim.label : 'Setup'} — Question {activeIndex + 1} of {questions.length}
          <span className="text-muted-foreground/40 ml-2 text-xs font-normal">
            {answeredCount} answered
          </span>
        </h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
          aria-label="Cancel setup"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Card area — fixed height container for consistent sizing */}
      <div className="flex items-center gap-4 px-6 py-5">
        {/* Left arrow */}
        <button
          onClick={goPrev}
          disabled={!canPrev}
          className={`flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
            canPrev
              ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70 hover:text-foreground'
              : 'border-primary/5 text-foreground/10 cursor-default'
          }`}
          aria-label="Previous question"
        >
          <ChevronLeft className="w-4.5 h-4.5" />
        </button>

        {/* Card — fixed height */}
        <div className="flex-1 min-w-0" style={{ height: CARD_HEIGHT }}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={activeIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={`h-full flex flex-col p-5 rounded-xl border ${tone.border} ${tone.bg}`}
            >
              {/* Top row: category + question number */}
              <div className="flex items-center justify-between mb-3">
                {dim ? (
                  <div className="flex items-center gap-2">
                    <dim.Icon className={`w-4 h-4 ${tone.accent}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${tone.accent}`}>
                      {dim.label}
                    </span>
                  </div>
                ) : <div />}
                <span className={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-md bg-foreground/[0.04] text-muted-foreground/50`}>
                  {activeIndex + 1}/{questions.length}
                </span>
              </div>

              {/* Question text */}
              <p className="text-[15px] font-medium text-foreground/90 leading-relaxed mb-1.5">
                {q.question}
              </p>

              {/* Context */}
              {q.context && (
                <div className="flex items-start gap-2 mb-4">
                  <Info className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
                  <p className="text-[13px] text-foreground/45 leading-relaxed">{q.context}</p>
                </div>
              )}

              {/* Input area — flex-1 to fill remaining card space */}
              <div className={`flex-1 mt-auto pt-2 ${q.type === 'devtools_project' ? 'overflow-visible' : 'overflow-y-auto'}`}>
                {/* SELECT */}
                {q.type === 'select' && q.options && (
                  <div className="space-y-1.5">
                    {q.options.map((opt) => {
                      const isSelected = currentAnswer === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          data-testid={`question-option-${opt.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`}
                          onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`w-full text-left px-3.5 py-2.5 text-sm rounded-lg border transition-all flex items-center gap-2.5 ${
                            isSelected
                              ? `${tone.selectBg} font-medium`
                              : 'text-foreground/70 border-primary/10 hover:bg-secondary/40 hover:border-primary/15'
                          }`}
                        >
                          {/* Radio indicator */}
                          <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                            isSelected ? 'border-current' : 'border-foreground/20'
                          }`}>
                            {isSelected && <span className="w-2 h-2 rounded-full bg-current" />}
                          </span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* TEXT */}
                {q.type === 'text' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      data-testid="question-text-input"
                      value={currentAnswer}
                      onChange={(e) => onAnswerUpdated(q.id, e.target.value)}
                      placeholder={(q as unknown as Record<string, unknown>).placeholder as string ?? q.default ?? 'Type your answer...'}
                      autoFocus
                      className={`w-full px-4 py-3 text-sm rounded-xl border border-primary/15 bg-background/80 text-foreground placeholder-muted-foreground/35 ring-2 ring-transparent transition-all ${tone.inputRing}`}
                    />
                    {currentAnswer && currentAnswer !== q.default && (
                      <p className="text-xs text-muted-foreground/40 px-1">
                        Default: {q.default || 'none'}
                      </p>
                    )}
                  </div>
                )}

                {/* BOOLEAN */}
                {q.type === 'boolean' && (
                  <div className="flex gap-3">
                    {['Yes', 'No'].map((opt) => {
                      const isSelected = currentAnswer === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          data-testid={`question-bool-${opt.toLowerCase()}`}
                          onClick={() => onAnswerUpdated(q.id, opt)}
                          className={`flex-1 py-3.5 text-sm font-medium rounded-xl border transition-all flex items-center justify-center gap-2 ${
                            isSelected
                              ? `${tone.selectBg} shadow-elevation-1`
                              : 'text-foreground/60 border-primary/10 hover:bg-secondary/40 hover:border-primary/15'
                          }`}
                        >
                          {isSelected && <Check className="w-4 h-4" />}
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* DEVTOOLS PROJECT SELECTOR */}
                {q.type === 'devtools_project' && (
                  <DevToolsProjectDropdown
                    value={currentAnswer || null}
                    onSelect={(project) => onAnswerUpdated(q.id, project.id)}
                    placeholder="Select a codebase project..."
                  />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right arrow */}
        <button
          onClick={goNext}
          disabled={!canNext}
          className={`flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
            canNext
              ? 'border-primary/20 hover:bg-secondary/50 text-foreground/70 hover:text-foreground'
              : 'border-primary/5 text-foreground/10 cursor-default'
          }`}
          aria-label="Next question"
        >
          <ChevronRight className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Progress dots — unanswered questions pulse when submit is blocked */}
      <div className="flex items-center justify-center gap-2 px-6 pb-1">
        {questions.map((qn, i) => {
          const dotTone = CARD_TONES[i % CARD_TONES.length]!;
          const isActive = i === activeIndex;
          const isAnswered = (() => {
            const val = userAnswers[qn.id];
            return val !== undefined && val !== '';
          })();
          const showUnansweredWarning = isLast && !allAnswered && !isAnswered && !isActive;
          return (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              title={`Question ${i + 1}${isAnswered ? ' (answered)' : ' (unanswered)'}`}
              className={`rounded-full transition-all duration-200 flex items-center justify-center ${
                isActive
                  ? `w-7 h-2.5 ${dotTone.dot}`
                  : isAnswered
                    ? `w-2.5 h-2.5 ${dotTone.dot} opacity-60`
                    : showUnansweredWarning
                      ? 'w-2.5 h-2.5 bg-rose-400 animate-pulse ring-2 ring-rose-400/30'
                      : 'w-2.5 h-2.5 bg-foreground/12'
              }`}
              aria-label={`Go to question ${i + 1}${isAnswered ? '' : ' (unanswered)'}`}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-primary/10 mt-2">
        <div className="flex items-center gap-4">
          <p className="text-xs text-muted-foreground/35">
            <kbd className="px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-[10px] font-mono">&larr;</kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-[10px] font-mono">&rarr;</kbd>{' '}navigate
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors flex items-center gap-1"
          >
            <SkipForward className="w-3 h-3" />
            Skip all
          </button>
        </div>

        <button
          type="button"
          data-testid="questionnaire-submit-btn"
          onClick={() => {
            if (isLast) {
              if (allAnswered) {
                onSubmit();
              } else if (firstUnansweredIndex >= 0) {
                // Navigate to first unanswered question
                goTo(firstUnansweredIndex);
              }
            } else {
              goNext();
            }
          }}
          className={`inline-flex items-center gap-2 rounded-xl text-sm font-medium transition-all ${
            isLast
              ? allAnswered
                ? 'px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-elevation-1'
                : 'px-6 py-2.5 bg-primary/50 text-primary-foreground/70 cursor-pointer hover:bg-primary/60'
              : 'px-5 py-2 bg-primary/10 text-primary hover:bg-primary/20'
          }`}
        >
          {isLast ? (
            allAnswered
              ? <>Submit Answers <Send className="w-3.5 h-3.5" /></>
              : <>Answer remaining ({questions.length - answeredCount})</>
          ) : (
            <>Next <ChevronRight className="w-3.5 h-3.5" /></>
          )}
        </button>
      </div>
    </BaseModal>
  );
}
