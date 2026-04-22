/**
 * Focus variant (consolidated baseline) — one question at a time in the upper
 * half, persona-being-built constellation in the lower half.
 *
 * Layout:
 *   Upper — the current question, centered and prominent, with a bottom-of-
 *           header stepper for quick jumps and keyboard nav. One decision on
 *           screen at a time so the user never feels overwhelmed.
 *   Lower — a star-field with the persona-core at its centre and each
 *           category orbiting as a planet. Every committed answer fires a
 *           coloured particle that streaks from its planet back to the core;
 *           the category the current question belongs to wears a rotating
 *           selection halo. Clicking a planet jumps to the first unanswered
 *           question in that category.
 *
 * Combining the two into a single screen replaced the old split-view live
 * preview. Rationale: the constellation is a stronger mental model for "the
 * persona is forming" than a category-bucketed text list, and the orbital
 * progress arcs communicate completeness at a glance — without the user
 * having to read.
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Columns2,
  MessageCircle,
} from 'lucide-react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import {
  QuestionCard,
  CATEGORY_META,
  FALLBACK_CATEGORY,
} from './QuestionnaireFormGrid';
import { QuestionnaireFormDialogue } from './QuestionnaireFormDialogue';
import { compareByCategoryOrder } from './questionnaireCategoryOrder';

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
  /** Map of use-case id → human title for rendering "Applies to" lines. */
  useCaseTitleById?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tab-switching shell
// ---------------------------------------------------------------------------

type Variant = 'baseline' | 'dialogue';

const VARIANT_TABS: Array<{
  id: Variant;
  label: string;
  sub: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'baseline', label: 'Focus', sub: 'question + orbit', Icon: Columns2 },
  { id: 'dialogue', label: 'Dialogue', sub: 'conversational', Icon: MessageCircle },
];

function VariantSwitcher({
  active,
  onChange,
}: {
  active: Variant;
  onChange: (v: Variant) => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-6 pt-3 pb-2 border-b border-border bg-foreground/[0.015]">
      <span className="text-[9px] font-semibold uppercase tracking-[0.24em] text-foreground/45 mr-1">
        Prototype
      </span>
      {VARIANT_TABS.map((tab) => {
        const isActive = active === tab.id;
        const { Icon } = tab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-card border cursor-pointer transition-all ${
              isActive
                ? 'bg-primary/15 border-primary/35 text-foreground'
                : 'bg-foreground/[0.02] border-border text-foreground/70 hover:bg-primary/[0.06] hover:border-primary/20'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-foreground/60'}`} />
            <div className="flex flex-col items-start leading-none">
              <span className="text-[11px] font-semibold">{tab.label}</span>
              <span className="text-[9px] uppercase tracking-wider opacity-60 mt-0.5">
                {tab.sub}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function QuestionnaireFormFocus(props: Props) {
  const [variant, setVariant] = useState<Variant>('baseline');

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <VariantSwitcher active={variant} onChange={setVariant} />
      <div className="flex-1 min-h-0 flex flex-col">
        {variant === 'baseline' && <QuestionnaireFormFocusBaseline {...props} />}
        {variant === 'dialogue' && <QuestionnaireFormDialogue {...props} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constellation helpers — shared between baseline render and pulse system
// ---------------------------------------------------------------------------

const ORBIT_R = 165;
const CORE_R = 42;

function polar(angleRad: number, r: number) {
  return { x: Math.cos(angleRad) * r, y: Math.sin(angleRad) * r };
}

function angleForIndex(i: number, total: number): number {
  if (total === 0) return 0;
  return (i / total) * Math.PI * 2 - Math.PI / 2;
}

// Deterministic star positions so layout stays stable across renders
const STARS = Array.from({ length: 56 }, (_, i) => {
  const s = (i * 9301 + 49297) % 233280;
  return {
    x: ((s * 17) % 540) - 270,
    y: ((s * 23) % 540) - 270,
    r: 0.3 + ((s * 5) % 100) / 120,
    delay: ((s * 13) % 100) / 25,
    dur: 2.5 + ((s * 7) % 30) / 10,
  };
});

type Pulse = { id: number; cat: string };

// ---------------------------------------------------------------------------
// Consolidated baseline — Focus + Constellation in one view
// ---------------------------------------------------------------------------

function QuestionnaireFormFocusBaseline({
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
  useCaseTitleById,
}: Props) {
  const { t, tx } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(() => {
    // Land on the first UNANSWERED question regardless of blocked-state.
    // Blocked questions are where credentials must be added — we want the
    // user to see the "Add credential" banner on that card, not to be
    // silently skipped past it to the next answerable question (which
    // leaves the blocker invisible until review).
    const first = questions.findIndex((q) => !userAnswers[q.id]);
    return first >= 0 ? first : 0;
  });

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

  // ── Keyboard nav ──────────────────────────────────────────────────────
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

  // ── Constellation state: per-category progress + pulse particles ─────
  const grouped = useMemo(() => {
    const buckets: Record<string, TransformQuestionResponse[]> = {};
    for (const q of questions) {
      const key = q.category ?? '__other__';
      (buckets[key] ??= []).push(q);
    }
    return buckets;
  }, [questions]);
  // Walk categories in the canonical order (questionnaireCategoryOrder),
  // not the insertion order the questions happened to arrive in. This keeps
  // the constellation planets and any category-indexed UI in the same order
  // MatrixAdoptionView uses to sort the questions themselves — so "step 1/6"
  // always corresponds to the first planet on the constellation.
  const categoryKeys = useMemo(
    () => Object.keys(grouped).sort(compareByCategoryOrder),
    [grouped],
  );

  const categoryProgress = useMemo(() => {
    const map: Record<string, { answered: number; total: number; pct: number }> = {};
    for (const cat of categoryKeys) {
      const qs = grouped[cat]!;
      const answered = qs.filter((q) => !!userAnswers[q.id]).length;
      map[cat] = {
        answered,
        total: qs.length,
        pct: qs.length > 0 ? answered / qs.length : 0,
      };
    }
    return map;
  }, [categoryKeys, grouped, userAnswers]);

  const [pulses, setPulses] = useState<Pulse[]>([]);
  const pulseSeq = useRef(0);
  const prevAnswersRef = useRef(userAnswers);

  useEffect(() => {
    const prev = prevAnswersRef.current;
    const freshlyAnswered: string[] = [];
    for (const q of questions) {
      const was = prev[q.id] ?? '';
      const now = userAnswers[q.id] ?? '';
      if (!was && now) freshlyAnswered.push(q.category ?? '__other__');
    }
    if (freshlyAnswered.length > 0) {
      setPulses((p) => [
        ...p.slice(-8),
        ...freshlyAnswered.map((cat) => ({ id: ++pulseSeq.current, cat })),
      ]);
    }
    prevAnswersRef.current = userAnswers;
  }, [userAnswers, questions]);

  useEffect(() => {
    if (pulses.length === 0) return;
    const timer = setTimeout(() => {
      setPulses((p) => (p.length > 3 ? p.slice(p.length - 3) : p));
    }, 1400);
    return () => clearTimeout(timer);
  }, [pulses]);

  // Click a planet → jump to first unanswered question in that category.
  // Falls back to the first question in that category if all answered.
  const jumpToCategory = useCallback(
    (cat: string) => {
      const firstUnanswered = questions.findIndex(
        (q) => (q.category ?? '__other__') === cat && !userAnswers[q.id],
      );
      if (firstUnanswered >= 0) {
        setActiveIdx(firstUnanswered);
        return;
      }
      const firstAny = questions.findIndex(
        (q) => (q.category ?? '__other__') === cat,
      );
      if (firstAny >= 0) setActiveIdx(firstAny);
    },
    [questions, userAnswers],
  );

  const currentCat = currentQuestion?.category ?? '__other__';

  if (!currentQuestion) return null;

  const currentMeta = CATEGORY_META[currentQuestion.category ?? ''] ?? FALLBACK_CATEGORY;
  const { Icon: CurrentIcon } = currentMeta;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Header — progress + live counter + stepper ─────────────────── */}
      <div className="flex-shrink-0 border-b border-border">
        <div className="max-w-5xl mx-auto px-6 pt-5 pb-4">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-primary/80" />
              <h2 className="text-lg font-semibold text-foreground">
                {t.templates.adopt_modal.configure_your_persona}
              </h2>
            </div>
            <span className="text-foreground">·</span>
            <div className="flex items-center gap-3 text-sm text-foreground tabular-nums">
              <span>
                {tx(t.templates.adopt_modal.answered_of_total, {
                  answered: answeredCount,
                  total: totalCount,
                })}
              </span>
              {blockedCount > 0 && (
                <span className="text-status-error/80 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {tx(t.templates.adopt_modal.blocked_count, { count: blockedCount })}
                </span>
              )}
            </div>
          </div>
          {/* Slim stepper strip — each question is a clickable dot. */}
          <div className="flex items-center justify-center gap-1 mt-3">
            {questions.map((q, i) => {
              const isActive = i === activeIdx;
              const isAnswered = !!userAnswers[q.id];
              const isBlocked = blockedQuestionIds?.has(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setActiveIdx(i)}
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
      </div>

      {/* ── Upper — question + answer (centered) ──────────────────────── */}
      <div className="flex-[3] min-h-[240px] overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-wider">
                <CurrentIcon className={`w-3.5 h-3.5 ${currentMeta.color}`} />
                <span className={`font-semibold ${currentMeta.color}`}>
                  {currentMeta.label}
                </span>
                <span className="text-foreground">·</span>
                <span className="text-foreground">
                  {tx(t.templates.adopt_modal.question_number_of, {
                    current: activeIdx + 1,
                    total: totalCount,
                  })}
                </span>
              </div>
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

              {/* Keyboard hint */}
              <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-foreground">
                <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.03] font-mono text-[10px]">
                  ←
                </kbd>
                <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.03] font-mono text-[10px]">
                  →
                </kbd>
                <span>{t.templates.adopt_modal.navigate_hint}</span>
                {isAtEnd && canSubmit && (
                  <>
                    <span className="text-foreground">·</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-foreground/[0.03] font-mono text-[10px]">
                      Enter
                    </kbd>
                    <span>{t.templates.adopt_modal.enter_to_advance}</span>
                  </>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Lower — constellation SVG ─────────────────────────────────── */}
      <div
        className="flex-[2] min-h-[240px] relative overflow-hidden border-t border-border bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.09)_0%,_transparent_55%)]"
      >
        <svg
          viewBox="-270 -200 540 400"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full text-primary"
        >
          <defs>
            <radialGradient id="focus-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
              <stop offset="45%" stopColor="currentColor" stopOpacity={0.2} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
            <filter id="focus-pulse-blur">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* Twinkling star-field */}
          <g opacity={0.9}>
            {STARS.map((s, i) => (
              <motion.circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={s.r}
                className="text-foreground/40"
                fill="currentColor"
                animate={{ opacity: [0.15, 0.6, 0.15] }}
                transition={{
                  duration: s.dur,
                  delay: s.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </g>

          {/* Orbit ring */}
          <circle
            cx={0}
            cy={0}
            r={ORBIT_R}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray="2 6"
            className="text-foreground"
          />

          {/* Beam from core → current-category planet */}
          {(() => {
            const i = categoryKeys.indexOf(currentCat);
            if (i < 0) return null;
            const a = angleForIndex(i, categoryKeys.length);
            const p = polar(a, ORBIT_R);
            return (
              <motion.line
                key={currentCat}
                x1={0}
                y1={0}
                x2={p.x}
                y2={p.y}
                stroke="currentColor"
                strokeOpacity={0.4}
                strokeWidth={1}
                className={CATEGORY_META[currentCat]?.color ?? FALLBACK_CATEGORY.color}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              />
            );
          })()}

          {/* Core glow */}
          <motion.circle
            cx={0}
            cy={0}
            r={CORE_R + 36}
            fill="url(#focus-core-glow)"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Core progress arc */}
          <circle
            cx={0}
            cy={0}
            r={CORE_R + 6}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeOpacity={0.15}
            className="text-foreground"
          />
          <motion.circle
            cx={0}
            cy={0}
            r={CORE_R + 6}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            transform="rotate(-90)"
            className="text-primary"
            style={{
              strokeDasharray: 2 * Math.PI * (CORE_R + 6),
              strokeDashoffset: 2 * Math.PI * (CORE_R + 6) * (1 - progressPct),
            }}
            initial={false}
            animate={{
              strokeDashoffset: 2 * Math.PI * (CORE_R + 6) * (1 - progressPct),
            }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />

          {/* Core body */}
          <motion.circle
            cx={0}
            cy={0}
            r={CORE_R}
            className="text-primary"
            fill="currentColor"
            fillOpacity={0.85}
            animate={{ r: [CORE_R, CORE_R + 2, CORE_R] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <circle cx={0} cy={0} r={CORE_R - 12} className="text-primary-foreground" fill="currentColor" fillOpacity={0.18} />

          {/* Core icon */}
          <g transform="translate(-10 -10)">
            <Sparkles width={20} height={20} className="text-primary-foreground" />
          </g>

          {/* Pulse particles */}
          <AnimatePresence>
            {pulses.map((p) => {
              const i = categoryKeys.indexOf(p.cat);
              if (i < 0) return null;
              const a = angleForIndex(i, categoryKeys.length);
              const from = polar(a, ORBIT_R);
              const meta = CATEGORY_META[p.cat] ?? FALLBACK_CATEGORY;
              return (
                <motion.circle
                  key={p.id}
                  r={5}
                  fill="currentColor"
                  className={meta.color}
                  filter="url(#focus-pulse-blur)"
                  initial={{ cx: from.x, cy: from.y, opacity: 0, scale: 0.4 }}
                  animate={{
                    cx: 0,
                    cy: 0,
                    opacity: [0, 1, 1, 0],
                    scale: [0.4, 1.3, 1, 0.6],
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, ease: [0.33, 0.67, 0.25, 1.0] }}
                />
              );
            })}
          </AnimatePresence>

          {/* Planets */}
          {categoryKeys.map((cat, i) => {
            const a = angleForIndex(i, categoryKeys.length);
            const pos = polar(a, ORBIT_R);
            const meta = CATEGORY_META[cat] ?? FALLBACK_CATEGORY;
            const prog = categoryProgress[cat]!;
            const isCurrent = cat === currentCat;
            const planetR = 22 + Math.min(10, prog.total * 1.5);
            const ringR = planetR + 4;
            const circumference = 2 * Math.PI * ringR;
            const Icon = meta.Icon;
            const complete = prog.pct === 1 && prog.total > 0;
            return (
              <g
                key={cat}
                style={{ cursor: 'pointer' }}
                onClick={() => jumpToCategory(cat)}
              >
                {/* Hit area */}
                <circle cx={pos.x} cy={pos.y} r={planetR + 22} fill="transparent" />

                {/* Selection halo for the current-question's category */}
                {isCurrent && (
                  <motion.circle
                    cx={pos.x}
                    cy={pos.y}
                    r={planetR + 12}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    className={meta.color}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{
                      opacity: [0.5, 0.9, 0.5],
                      rotate: 360,
                    }}
                    transition={{
                      opacity: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
                      rotate: { duration: 30, repeat: Infinity, ease: 'linear' },
                    }}
                    style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
                  />
                )}

                {/* Progress arc */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={ringR}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeOpacity={0.15}
                  className="text-foreground"
                />
                <motion.circle
                  cx={pos.x}
                  cy={pos.y}
                  r={ringR}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className={meta.color}
                  style={{
                    strokeDasharray: circumference,
                    strokeDashoffset: circumference * (1 - prog.pct),
                    transform: `rotate(-90deg)`,
                    transformOrigin: `${pos.x}px ${pos.y}px`,
                  }}
                  initial={false}
                  animate={{ strokeDashoffset: circumference * (1 - prog.pct) }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />

                {/* Planet body */}
                <motion.circle
                  cx={pos.x}
                  cy={pos.y}
                  r={planetR}
                  fill="currentColor"
                  fillOpacity={isCurrent ? 0.3 : complete ? 0.22 : 0.12}
                  stroke="currentColor"
                  strokeOpacity={isCurrent ? 0.8 : complete ? 0.55 : 0.25}
                  strokeWidth={isCurrent ? 2 : 1}
                  className={meta.color}
                  whileHover={{ scale: 1.06 }}
                  animate={{ scale: isCurrent ? 1.06 : 1 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
                />

                {/* Icon */}
                <g transform={`translate(${pos.x - 9} ${pos.y - 9})`} className={meta.color}>
                  <Icon width={18} height={18} />
                </g>

                {/* Label */}
                <text
                  x={pos.x}
                  y={pos.y + planetR + 16}
                  textAnchor="middle"
                  className={`${meta.color} font-semibold`}
                  fill="currentColor"
                  style={{
                    fontSize: '9px',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                  }}
                >
                  {meta.label}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + planetR + 27}
                  textAnchor="middle"
                  className="text-foreground"
                  fill="currentColor"
                  fillOpacity={0.55}
                  style={{ fontSize: '9px', fontVariantNumeric: 'tabular-nums' }}
                >
                  {prog.answered}/{prog.total}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Legend chip overlay */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-foreground/[0.04] border border-border text-[10px] text-foreground/60 backdrop-blur">
          <Sparkles className="w-3 h-3 text-primary/70" />
          {Math.round(progressPct * 100)}% persona formed
        </div>
      </div>

      {/* ── Footer nav ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={prev}
            disabled={activeIdx === 0}
            className="flex items-center gap-1.5 typo-body text-foreground hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {t.templates.adopt_modal.previous}
          </button>
          <div className="flex items-center gap-3">
            {isAtEnd && canSubmit ? (
              <button
                type="button"
                onClick={onSubmit}
                className="flex items-center gap-2 px-6 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 shadow-elevation-3 shadow-primary/20 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                {t.templates.adopt_modal.submit_all}
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={isAtEnd}
                className="flex items-center gap-2 px-5 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
              >
                {t.templates.adopt_modal.next}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
