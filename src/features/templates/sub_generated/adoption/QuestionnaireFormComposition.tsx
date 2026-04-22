/**
 * Composition variant — three-column synthesis of Focus + Dialogue.
 *
 * Goal: combine the spatial "persona-forming" metaphor from Focus with the
 * narrative "what-has-been-said-so-far" flow from Dialogue into a single
 * well-consumable surface. Each column owns one concept:
 *
 *   Left rail — a compact persona-avatar constellation (pulses when an
 *               answer commits, reacts to the current question's category)
 *               above a category nav with per-category progress bars.
 *   Centre    — the current question, big and prominent. Category crumb +
 *               QuestionCard + keyboard hints. The hero.
 *   Right rail— a vertical story thread: every question as a compact chip
 *               with status (answered/current/pending/blocked), grouped by
 *               category with chapter dividers. Every chip is click-to-
 *               jump, so the thread doubles as a jump-map.
 *
 * The three columns are visually unified by a shared header band at top
 * and shared category colour tokens throughout. An answer committing
 * triggers a coordinated response across all three:
 *   1. A particle races across the mini-constellation planet → core
 *   2. The answered category bar fills
 *   3. The thread chip transforms from "pending" to "answered"
 *
 * Rationale: Focus isolates the constellation as a passive decoration;
 * Dialogue loses the spatial mental model entirely. Composition makes
 * both live in service of the same decision — the next answer.
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDot,
  AlertCircle,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function polar(angleRad: number, r: number) {
  return { x: Math.cos(angleRad) * r, y: Math.sin(angleRad) * r };
}

function angleForIndex(i: number, total: number): number {
  if (total === 0) return 0;
  return (i / total) * Math.PI * 2 - Math.PI / 2;
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

type Pulse = { id: number; cat: string };

// ---------------------------------------------------------------------------
// MiniConstellation — compact SVG avatar for the left rail
// ---------------------------------------------------------------------------

const MINI_ORBIT_R = 56;
const MINI_CORE_R = 14;

function MiniConstellation({
  categoryKeys,
  categoryProgress,
  currentCat,
  progressPct,
  pulses,
  onJump,
}: {
  categoryKeys: string[];
  categoryProgress: Record<string, { answered: number; total: number; pct: number }>;
  currentCat: string;
  progressPct: number;
  pulses: Pulse[];
  onJump: (cat: string) => void;
}) {
  const coreCircumference = 2 * Math.PI * (MINI_CORE_R + 4);
  return (
    <div className="flex flex-col items-center pt-4 pb-3 border-b border-border relative">
      <svg
        viewBox="-80 -80 160 160"
        className="w-[160px] h-[160px] text-primary"
      >
        <defs>
          <radialGradient id="mini-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.45} />
            <stop offset="50%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
          <filter id="mini-pulse-blur">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        {/* Orbit ring */}
        <circle
          cx={0}
          cy={0}
          r={MINI_ORBIT_R}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeDasharray="1.5 4"
          className="text-foreground"
        />

        {/* Beam to current category */}
        {(() => {
          const i = categoryKeys.indexOf(currentCat);
          if (i < 0) return null;
          const a = angleForIndex(i, categoryKeys.length);
          const p = polar(a, MINI_ORBIT_R);
          return (
            <motion.line
              key={currentCat}
              x1={0}
              y1={0}
              x2={p.x}
              y2={p.y}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={0.8}
              className={CATEGORY_META[currentCat]?.color ?? FALLBACK_CATEGORY.color}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
          );
        })()}

        {/* Core glow */}
        <motion.circle
          cx={0}
          cy={0}
          r={MINI_CORE_R + 12}
          fill="url(#mini-core-glow)"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Core progress arc */}
        <circle
          cx={0}
          cy={0}
          r={MINI_CORE_R + 4}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={1.6}
          className="text-foreground"
        />
        <motion.circle
          cx={0}
          cy={0}
          r={MINI_CORE_R + 4}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          transform="rotate(-90)"
          className="text-primary"
          style={{
            strokeDasharray: coreCircumference,
            strokeDashoffset: coreCircumference * (1 - progressPct),
          }}
          initial={false}
          animate={{ strokeDashoffset: coreCircumference * (1 - progressPct) }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />

        {/* Core body */}
        <motion.circle
          cx={0}
          cy={0}
          r={MINI_CORE_R}
          className="text-primary"
          fill="currentColor"
          fillOpacity={0.85}
          animate={{ r: [MINI_CORE_R, MINI_CORE_R + 1, MINI_CORE_R] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <g transform="translate(-7 -7)">
          <Sparkles width={14} height={14} className="text-primary-foreground" />
        </g>

        {/* Pulse particles */}
        <AnimatePresence>
          {pulses.map((p) => {
            const i = categoryKeys.indexOf(p.cat);
            if (i < 0) return null;
            const a = angleForIndex(i, categoryKeys.length);
            const from = polar(a, MINI_ORBIT_R);
            const meta = CATEGORY_META[p.cat] ?? FALLBACK_CATEGORY;
            return (
              <motion.circle
                key={p.id}
                r={3}
                fill="currentColor"
                className={meta.color}
                filter="url(#mini-pulse-blur)"
                initial={{ cx: from.x, cy: from.y, opacity: 0, scale: 0.4 }}
                animate={{
                  cx: 0,
                  cy: 0,
                  opacity: [0, 1, 1, 0],
                  scale: [0.4, 1.2, 1, 0.5],
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.0, ease: [0.33, 0.67, 0.25, 1.0] }}
              />
            );
          })}
        </AnimatePresence>

        {/* Planets */}
        {categoryKeys.map((cat, i) => {
          const a = angleForIndex(i, categoryKeys.length);
          const pos = polar(a, MINI_ORBIT_R);
          const meta = CATEGORY_META[cat] ?? FALLBACK_CATEGORY;
          const prog = categoryProgress[cat]!;
          const isCurrent = cat === currentCat;
          const planetR = 7 + Math.min(3, prog.total * 0.5);
          const ringR = planetR + 2.5;
          const circumference = 2 * Math.PI * ringR;
          const complete = prog.pct === 1 && prog.total > 0;
          return (
            <g
              key={cat}
              style={{ cursor: 'pointer' }}
              onClick={() => onJump(cat)}
            >
              <circle cx={pos.x} cy={pos.y} r={planetR + 10} fill="transparent" />
              {isCurrent && (
                <motion.circle
                  cx={pos.x}
                  cy={pos.y}
                  r={planetR + 6}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={0.6}
                  strokeDasharray="2 2"
                  className={meta.color}
                  animate={{ opacity: [0.5, 0.9, 0.5], rotate: 360 }}
                  transition={{
                    opacity: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
                    rotate: { duration: 28, repeat: Infinity, ease: 'linear' },
                  }}
                  style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={ringR}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={1.2}
                className="text-foreground"
              />
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={ringR}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
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
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={planetR}
                fill="currentColor"
                fillOpacity={isCurrent ? 0.35 : complete ? 0.25 : 0.14}
                stroke="currentColor"
                strokeOpacity={isCurrent ? 0.85 : complete ? 0.6 : 0.3}
                strokeWidth={isCurrent ? 1.4 : 0.8}
                className={meta.color}
                animate={{ scale: isCurrent ? 1.08 : 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
              />
            </g>
          );
        })}
      </svg>
      <span className="text-[10px] uppercase tracking-[0.22em] text-foreground/55 font-semibold -mt-2">
        {Math.round(progressPct * 100)}% formed
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail: category navigation
// ---------------------------------------------------------------------------

function CategoryNavItem({
  cat,
  progress,
  isCurrent,
  hasBlocked,
  onClick,
}: {
  cat: string;
  progress: { answered: number; total: number; pct: number };
  isCurrent: boolean;
  hasBlocked: boolean;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[cat] ?? FALLBACK_CATEGORY;
  const { Icon } = meta;
  const complete = progress.pct === 1 && progress.total > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-card px-2.5 py-2 transition-all border ${
        isCurrent
          ? 'bg-foreground/[0.04] border-border'
          : 'bg-transparent border-transparent hover:bg-foreground/[0.02]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
        <span
          className={`flex-1 text-[10px] font-semibold uppercase tracking-[0.16em] truncate ${meta.color}`}
        >
          {meta.label}
        </span>
        {isCurrent && (
          <span className="text-[8px] uppercase tracking-wider text-primary font-semibold">
            here
          </span>
        )}
        {complete && !isCurrent && (
          <Check className={`w-3 h-3 ${meta.color}`} />
        )}
        {hasBlocked && !isCurrent && (
          <AlertCircle className="w-3 h-3 text-status-error" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-foreground/[0.08] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              hasBlocked ? 'bg-status-error/70' : complete ? 'bg-status-success/80' : 'bg-current'
            }`}
            style={{ color: 'currentColor' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress.pct * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <span className="text-[9px] text-foreground/55 font-mono tabular-nums">
          {progress.answered}/{progress.total}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Right rail: story thread
// ---------------------------------------------------------------------------

type ThreadState = 'answered' | 'current' | 'pending' | 'blocked';

function ThreadItem({
  question,
  answer,
  state,
  isAuto,
  onClick,
}: {
  question: TransformQuestionResponse;
  answer: string;
  state: ThreadState;
  isAuto: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const meta = CATEGORY_META[question.category ?? ''] ?? FALLBACK_CATEGORY;
  const StatusIcon =
    state === 'answered'
      ? Check
      : state === 'current'
        ? ArrowRight
        : state === 'blocked'
          ? AlertCircle
          : CircleDot;
  const statusColor =
    state === 'answered'
      ? 'text-status-success'
      : state === 'current'
        ? 'text-primary'
        : state === 'blocked'
          ? 'text-status-error'
          : 'text-status-warning/60';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-card px-2.5 py-2 transition-colors group relative ${
        state === 'current'
          ? 'bg-primary/10 border border-primary/25'
          : 'hover:bg-foreground/[0.03] border border-transparent'
      }`}
    >
      {/* Left category accent bar for current item */}
      {state === 'current' && (
        <span
          className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${meta.color} bg-current`}
        />
      )}
      <div className="flex items-start gap-2">
        <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${statusColor}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-foreground/85 leading-snug truncate">
            {question.question}
          </div>
          {state === 'answered' && answer ? (
            <div className="text-[10px] text-foreground/60 leading-tight mt-0.5 truncate italic">
              {summarizeAnswer(answer, question.type, t)}
              {isAuto && (
                <span className="ml-1 text-[8px] uppercase tracking-wider text-brand-purple/80 font-semibold not-italic">
                  auto
                </span>
              )}
            </div>
          ) : state === 'current' ? (
            <div className="text-[9px] uppercase tracking-[0.2em] text-primary/80 font-semibold mt-0.5">
              current
            </div>
          ) : state === 'blocked' ? (
            <div className="text-[10px] text-status-error/80 leading-tight mt-0.5">
              credential needed
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuestionnaireFormComposition({
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
  const { t, tx } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(() => {
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

  // Keyboard nav (same contract as other variants)
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

  // Category grouping + per-category progress + blocked-state set
  const grouped = useMemo(() => {
    const buckets: Record<string, TransformQuestionResponse[]> = {};
    for (const q of questions) {
      const key = q.category ?? '__other__';
      (buckets[key] ??= []).push(q);
    }
    return buckets;
  }, [questions]);
  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);

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

  const categoryHasBlocked = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const cat of categoryKeys) {
      map[cat] = grouped[cat]!.some((q) => blockedQuestionIds?.has(q.id));
    }
    return map;
  }, [categoryKeys, grouped, blockedQuestionIds]);

  // Pulse system — same behaviour as Focus
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

  // Resolve each question's thread state for the right-rail list
  const threadStateFor = (i: number): ThreadState => {
    const q = questions[i]!;
    if (blockedQuestionIds?.has(q.id)) return 'blocked';
    if (i === activeIdx) return 'current';
    if (userAnswers[q.id]) return 'answered';
    return 'pending';
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Shared header band ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
        <div className="flex items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-primary/30"
                animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
              />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">
                {templateName ?? t.templates.adopt_modal.untitled_agent}
              </span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">
                {t.templates.adopt_modal.configure_your_persona}
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-xs text-foreground tabular-nums">
            <span>
              {tx(t.templates.adopt_modal.answered_of_total, {
                answered: answeredCount,
                total: totalCount,
              })}
            </span>
            {blockedCount > 0 && (
              <span className="text-status-error/80 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {tx(t.templates.adopt_modal.blocked_count, { count: blockedCount })}
              </span>
            )}
            <span className="font-semibold text-primary">
              {Math.round(progressPct * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Three-column body ─────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ── Left rail ────────────────────────────────────────────── */}
        <aside className="w-[220px] flex-shrink-0 border-r border-border bg-foreground/[0.01] flex flex-col min-h-0">
          <MiniConstellation
            categoryKeys={categoryKeys}
            categoryProgress={categoryProgress}
            currentCat={currentCat}
            progressPct={progressPct}
            pulses={pulses}
            onJump={jumpToCategory}
          />
          <div className="flex-shrink-0 px-3 pt-3 pb-1 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.22em] text-foreground/50 font-semibold">
              Categories
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {categoryKeys.map((cat) => (
              <CategoryNavItem
                key={cat}
                cat={cat}
                progress={categoryProgress[cat]!}
                isCurrent={cat === currentCat}
                hasBlocked={!!categoryHasBlocked[cat]}
                onClick={() => jumpToCategory(cat)}
              />
            ))}
          </nav>
        </aside>

        {/* ── Centre: hero question ───────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-8 py-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentQuestion.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  {/* Category crumb */}
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

                  {/* Hero card wrapper with subtle category-tinted rail */}
                  <div className="relative">
                    <span
                      aria-hidden
                      className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${currentMeta.color} bg-current opacity-40`}
                    />
                    <div className="pl-4">
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
        </main>

        {/* ── Right rail: story thread ───────────────────────────── */}
        <aside className="w-[300px] flex-shrink-0 border-l border-border bg-foreground/[0.01] flex flex-col min-h-0">
          <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-primary/70" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-foreground/55 font-semibold">
              Story so far
            </span>
            <span className="ml-auto text-[10px] text-foreground/50 tabular-nums">
              {answeredCount}/{totalCount}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {questions.map((q, i) => {
              const prevCat = i > 0 ? questions[i - 1]!.category ?? '__other__' : null;
              const thisCat = q.category ?? '__other__';
              const showChapter = prevCat !== thisCat;
              const meta = CATEGORY_META[thisCat] ?? FALLBACK_CATEGORY;
              return (
                <div key={q.id}>
                  {showChapter && (
                    <div className="flex items-center gap-1.5 px-1 pt-2 pb-1">
                      <meta.Icon className={`w-3 h-3 ${meta.color}`} />
                      <span
                        className={`text-[9px] uppercase tracking-[0.2em] font-semibold ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  <ThreadItem
                    question={q}
                    answer={userAnswers[q.id] ?? ''}
                    state={threadStateFor(i)}
                    isAuto={!!autoDetectedIds?.has(q.id)}
                    onClick={() => setActiveIdx(i)}
                  />
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* ── Footer nav ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border">
        <div className="flex items-center justify-between px-6 py-3">
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
