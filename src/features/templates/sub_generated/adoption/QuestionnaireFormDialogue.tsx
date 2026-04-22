/**
 * Dialogue variant — chat-interface metaphor for adopting a persona.
 *
 * Re-frames the questionnaire as a conversation: the persona-being-built
 * introduces itself and asks you about itself, message by message. Already-
 * answered questions remain in the scroll as past dialogue turns (you can
 * click any of them to jump back). The current question is the freshest
 * persona message; your answer composes just below in a docked widget.
 *
 * Mental model: you are meeting your agent, not filling a form.
 */
import { Fragment, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Check, ArrowRight, AlertCircle, CircleDot } from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import { useTranslation } from '@/i18n/useTranslation';
import { summarizeSourceDefinition } from '@/features/shared/components/forms/SourceDefinitionInput';
import {
  QuestionCard,
  CATEGORY_META,
  FALLBACK_CATEGORY,
} from './QuestionnaireFormGrid';

interface Props {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  autoDetectedIds?: Set<string>;
  blockedQuestionIds?: Set<string>;
  filteredOptions?: Record<string, string[]>;
  dynamicOptions?: Record<string, DynamicOptionState>;
  onRetryDynamic?: (questionId: string) => void;
  onAddCredential?: (vaultCategory: string) => void;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  templateName?: string;
  useCaseTitleById?: Record<string, string>;
}

function summarizeAnswer(
  raw: string,
  questionType?: TransformQuestionResponse['type'],
  t?: ReturnType<typeof useTranslation>['t'],
): string {
  if (!raw) return '';
  if (questionType === 'source_definition') {
    return summarizeSourceDefinition(raw, t);
  }
  if (raw === 'all') return t?.templates.adopt_modal.all_option ?? 'All';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? raw;
  if (parts.length === 2) return parts.join(' and ');
  return `${parts[0]}, ${parts[1]} +${parts.length - 2} more`;
}

// ---------------------------------------------------------------------------
// Message sub-components
// ---------------------------------------------------------------------------

function PersonaAvatar({ active = false }: { active?: boolean }) {
  return (
    <div
      className={`relative w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        active ? 'bg-primary/20 ring-2 ring-primary/30' : 'bg-primary/15'
      }`}
    >
      <Sparkles className="w-4 h-4 text-primary" />
      {active && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-primary/40"
          animate={{ scale: [1, 1.35, 1], opacity: [0.8, 0, 0.8] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </div>
  );
}

function PersonaBubble({
  children,
  category,
  sublabel,
  typing = false,
}: {
  children: React.ReactNode;
  category?: string;
  sublabel?: string;
  typing?: boolean;
}) {
  const meta = CATEGORY_META[category ?? ''] ?? FALLBACK_CATEGORY;
  return (
    <div className="flex items-start gap-2.5 max-w-[85%]">
      <PersonaAvatar active={typing} />
      <div className="flex flex-col items-start gap-1 min-w-0">
        {category && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${meta.color}`}
          >
            {meta.label}
          </span>
        )}
        <div className="rounded-2xl rounded-tl-sm bg-foreground/[0.04] border border-border px-3.5 py-2.5 text-sm text-foreground leading-relaxed shadow-sm">
          {typing ? <TypingDots /> : children}
        </div>
        {sublabel && (
          <span className="text-[10px] text-foreground/45 ml-1">{sublabel}</span>
        )}
      </div>
    </div>
  );
}

function UserBubble({
  children,
  onClick,
  isAuto,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  isAuto?: boolean;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <div className="flex justify-end">
      <Wrapper
        onClick={onClick}
        className={`flex items-start gap-2 max-w-[75%] text-left group ${
          onClick ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="rounded-2xl rounded-tr-sm bg-primary/15 border border-primary/25 px-3.5 py-2 text-sm font-medium text-foreground leading-snug group-hover:bg-primary/20 transition-colors">
          {children}
          {isAuto && (
            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-brand-purple/80 font-semibold">
              auto
            </span>
          )}
        </div>
        <div className="w-6 h-6 rounded-full bg-status-success/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Check className="w-3 h-3 text-status-success" />
        </div>
      </Wrapper>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full bg-foreground/50"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

function CategoryChapter({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? FALLBACK_CATEGORY;
  const { Icon } = meta;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-border" />
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] ${meta.color}`}>
        <Icon className="w-3 h-3" />
        {meta.label}
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuestionnaireFormDialogue({
  questions,
  userAnswers,
  autoDetectedIds,
  blockedQuestionIds,
  filteredOptions,
  dynamicOptions,
  onRetryDynamic,
  onAddCredential,
  onAnswerUpdated,
  onSubmit,
  templateName,
  useCaseTitleById,
}: Props) {
  const { t } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(() => {
    const first = questions.findIndex(
      (q) => !userAnswers[q.id] && !blockedQuestionIds?.has(q.id),
    );
    return first >= 0 ? first : 0;
  });
  const [showTyping, setShowTyping] = useState(true);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const currentQuestion = questions[activeIdx];
  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const canSubmit = answeredCount === totalCount && blockedCount === 0;
  const isAtEnd = activeIdx === totalCount - 1;
  const progressPct = totalCount > 0 ? answeredCount / totalCount : 0;
  const currentAnswered = !!userAnswers[currentQuestion?.id ?? ''];

  const next = useCallback(() => {
    setActiveIdx((i) => Math.min(i + 1, totalCount - 1));
  }, [totalCount]);
  const prev = useCallback(() => {
    setActiveIdx((i) => Math.max(i - 1, 0));
  }, []);

  // Typing simulation — when the active question changes, briefly show the
  // persona "thinking" before revealing the message. Makes the interaction
  // feel alive without blocking interaction.
  useEffect(() => {
    setShowTyping(true);
    const t = setTimeout(() => setShowTyping(false), 450);
    return () => clearTimeout(t);
  }, [activeIdx]);

  // Auto-scroll the stream when a new message appears
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [activeIdx, showTyping]);

  // Keyboard nav — ArrowLeft/Right when not typing; Enter to advance
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isInput = tag === 'INPUT';
      const isTextarea = tag === 'TEXTAREA';
      const isTyping = isInput || isTextarea || target.isContentEditable;

      if (e.key === 'Enter') {
        if (isTextarea && e.shiftKey) return;
        if (isInput) {
          const inputType = (target as HTMLInputElement).type;
          if (inputType && inputType !== 'text' && inputType !== '' && inputType !== 'search') return;
        }
        if (isAtEnd && canSubmit) {
          e.preventDefault();
          onSubmit();
          return;
        }
        if (currentAnswered) {
          e.preventDefault();
          next();
        }
        return;
      }
      if (isTyping) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, isAtEnd, canSubmit, onSubmit, currentAnswered]);

  // History — every question the user has navigated past. We render these as
  // past dialogue turns. Clicking a turn jumps back to let the user revise.
  const history = questions.slice(0, activeIdx);

  // Detect category transitions in the history render so we can draw a
  // chapter divider between category changes.
  const personaIntro = useMemo(() => {
    const label = templateName?.trim();
    if (label) return `Hi — I'm going to be ${label}. Walk me through a few things so I know how to behave.`;
    return 'Hi — walk me through a few things so I know how to behave.';
  }, [templateName]);

  if (!currentQuestion) return null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Chat header ──────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center gap-3">
        <PersonaAvatar active />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">
            {templateName ?? t.templates.adopt_modal.untitled_agent}
          </div>
          <div className="text-[11px] text-foreground/55 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            forming · {answeredCount}/{totalCount} known
            {blockedCount > 0 && (
              <span className="text-status-error/80 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {blockedCount} blocked
              </span>
            )}
          </div>
        </div>
        <ProgressRing pct={progressPct} />
      </div>

      {/* ── Chat stream ──────────────────────────────────────── */}
      <div ref={streamRef} className="flex-1 overflow-y-auto px-4 py-5 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.04)_0%,_transparent_55%)]">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Intro message */}
          <PersonaBubble>{personaIntro}</PersonaBubble>

          {/* History */}
          {history.map((q, i) => {
            const prevCat = i > 0 ? history[i - 1]!.category ?? '__other__' : null;
            const thisCat = q.category ?? '__other__';
            const showChapter = prevCat !== thisCat;
            const answer = userAnswers[q.id];
            const isAuto = autoDetectedIds?.has(q.id);
            return (
              <Fragment key={q.id}>
                {showChapter && <CategoryChapter category={thisCat} />}
                <PersonaBubble category={thisCat}>{q.question}</PersonaBubble>
                {answer ? (
                  <UserBubble
                    onClick={() => setActiveIdx(i)}
                    isAuto={isAuto}
                  >
                    {summarizeAnswer(answer, q.type, t)}
                  </UserBubble>
                ) : (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveIdx(i)}
                      className="flex items-center gap-1.5 text-[11px] text-status-warning/80 hover:text-status-warning italic px-2"
                    >
                      <CircleDot className="w-3 h-3" />
                      skipped · tap to answer
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}

          {/* Current question — shows typing then the message */}
          {(() => {
            const prevCat = history.length > 0 ? history[history.length - 1]!.category ?? '__other__' : null;
            const thisCat = currentQuestion.category ?? '__other__';
            const showChapter = prevCat !== thisCat;
            return (
              <>
                {showChapter && <CategoryChapter category={thisCat} />}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`current-${currentQuestion.id}-${showTyping ? 'typing' : 'msg'}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <PersonaBubble category={thisCat} typing={showTyping}>
                      {currentQuestion.question}
                    </PersonaBubble>
                  </motion.div>
                </AnimatePresence>
                {/* Context tip, if any */}
                {!showTyping && currentQuestion.context && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="ml-11 text-[11px] text-foreground/55 italic leading-relaxed max-w-[85%]"
                  >
                    {currentQuestion.context}
                  </motion.div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Composer dock ────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border bg-foreground/[0.02]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-[0.22em] text-foreground/50">
            <span>Your reply</span>
            <div className="flex-1 h-px bg-border" />
            <span className="tabular-nums">
              {activeIdx + 1}/{totalCount}
            </span>
          </div>
          <div className="rounded-2xl bg-background border border-border px-3 py-2">
            <QuestionCard
              question={currentQuestion}
              answer={userAnswers[currentQuestion.id] ?? ''}
              onAnswer={(v) => onAnswerUpdated(currentQuestion.id, v)}
              isAutoDetected={autoDetectedIds?.has(currentQuestion.id)}
              isBlocked={blockedQuestionIds?.has(currentQuestion.id)}
              onAddCredential={onAddCredential}
              filteredOptions={filteredOptions?.[currentQuestion.id]}
              dynamicState={dynamicOptions?.[currentQuestion.id]}
              onRetryDynamic={onRetryDynamic}
              useCaseTitleById={useCaseTitleById}
            />
          </div>
        </div>
      </div>

      {/* ── Footer nav ───────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={prev}
            disabled={activeIdx === 0}
            className="text-xs text-foreground hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← {t.templates.adopt_modal.previous}
          </button>
          {isAtEnd && canSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-elevation-3 shadow-primary/20 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Meet your persona
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={!currentAnswered || isAtEnd}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {t.templates.adopt_modal.next}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressRing — a small circular progress indicator for the chat header
// ---------------------------------------------------------------------------

function ProgressRing({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-8 h-8 flex-shrink-0">
      <svg viewBox="0 0 32 32" className="w-full h-full -rotate-90">
        <circle cx={16} cy={16} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={3} className="text-foreground" />
        <motion.circle
          cx={16}
          cy={16}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          className="text-primary"
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ strokeDasharray: c }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-foreground">
        {Math.round(pct * 100)}
      </span>
    </div>
  );
}
