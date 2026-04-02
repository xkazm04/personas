import { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Send, Check, X, Sparkles,
  KeyRound, Settings2, ShieldCheck, Brain, Bell, Globe, Gauge,
  Info, CircleDot,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { DevToolsProjectDropdown } from '@/features/shared/components/forms/DevToolsProjectDropdown';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionnaireFormGridProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Category meta
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<
  string,
  { label: string; Icon: React.ComponentType<{ className?: string }>; color: string; bg: string; border: string }
> = {
  credentials:       { label: 'Credentials',       Icon: KeyRound,    color: 'text-violet-400',  bg: 'bg-violet-500/[0.04]',  border: 'border-violet-500/15' },
  configuration:     { label: 'Configuration',     Icon: Settings2,   color: 'text-blue-400',    bg: 'bg-blue-500/[0.04]',    border: 'border-blue-500/15' },
  human_in_the_loop: { label: 'Human in the Loop', Icon: ShieldCheck, color: 'text-rose-400',    bg: 'bg-rose-500/[0.04]',    border: 'border-rose-500/15' },
  memory:            { label: 'Memory & Learning',  Icon: Brain,       color: 'text-purple-400',  bg: 'bg-purple-500/[0.04]',  border: 'border-purple-500/15' },
  notifications:     { label: 'Notifications',     Icon: Bell,        color: 'text-amber-400',   bg: 'bg-amber-500/[0.04]',   border: 'border-amber-500/15' },
  domain:            { label: 'Domain',            Icon: Globe,       color: 'text-cyan-400',    bg: 'bg-cyan-500/[0.04]',    border: 'border-cyan-500/15' },
  quality:           { label: 'Quality',           Icon: Gauge,       color: 'text-emerald-400', bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/15' },
};

const FALLBACK_CATEGORY = {
  label: 'Other',
  Icon: Settings2,
  color: 'text-zinc-400',
  bg: 'bg-white/[0.02]',
  border: 'border-white/[0.06]',
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(questions: TransformQuestionResponse[]) {
  const groups: Record<string, TransformQuestionResponse[]> = {};
  for (const q of questions) {
    const key = q.category ?? '__other__';
    (groups[key] ??= []).push(q);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const pct = total === 0 ? 0 : (answered / total) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <span className="text-xs text-muted-foreground/60 tabular-nums whitespace-nowrap">
        {answered}/{total} answered
      </span>
    </div>
  );
}

function SelectPills({
  options,
  value,
  onChange,
  allowCustom,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  allowCustom?: boolean;
}) {
  const isCustomValue = allowCustom && value && !options.includes(value);
  const [showCustomInput, setShowCustomInput] = useState(isCustomValue ?? false);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCustomInput) {
      setTimeout(() => customInputRef.current?.focus(), 50);
    }
  }, [showCustomInput]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = !showCustomInput && value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => { setShowCustomInput(false); onChange(opt); }}
              className={`px-3 py-1 text-xs rounded-lg border transition-all ${
                selected
                  ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                  : 'bg-white/[0.03] border-white/[0.06] text-foreground/70 hover:bg-white/[0.06] hover:border-white/[0.1]'
              }`}
            >
              {opt}
            </button>
          );
        })}
        {allowCustom && (
          <button
            type="button"
            onClick={() => { setShowCustomInput(true); if (!isCustomValue) onChange(''); }}
            className={`px-3 py-1 text-xs rounded-lg border transition-all ${
              showCustomInput
                ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                : 'bg-white/[0.03] border-white/[0.06] text-foreground/70 hover:bg-white/[0.06] hover:border-white/[0.1]'
            }`}
          >
            Custom...
          </button>
        )}
      </div>
      {allowCustom && showCustomInput && (
        <input
          ref={customInputRef}
          type="text"
          value={isCustomValue ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your custom value..."
          className="w-full max-w-sm px-3 py-1.5 text-sm rounded-lg border border-primary/20 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      )}
    </div>
  );
}

function BooleanToggle({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {['Yes', 'No'].map((opt) => {
        const selected = value.toLowerCase() === opt.toLowerCase();
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt.toLowerCase())}
            className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-all ${
              selected
                ? opt === 'Yes'
                  ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400 font-medium'
                  : 'bg-rose-500/15 border-rose-500/25 text-rose-400 font-medium'
                : 'bg-white/[0.03] border-white/[0.06] text-foreground/70 hover:bg-white/[0.06]'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({
  question,
  answer,
  onAnswer,
  inputRef,
}: {
  question: TransformQuestionResponse;
  answer: string;
  onAnswer: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [flash, setFlash] = useState(false);
  const prevAnswer = useRef(answer);

  useEffect(() => {
    if (answer && answer !== prevAnswer.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      prevAnswer.current = answer;
      return () => clearTimeout(t);
    }
    prevAnswer.current = answer;
  }, [answer]);

  const isAnswered = !!answer;

  return (
    <div
      className={`relative rounded-lg px-3 py-2.5 transition-colors ${
        flash ? 'bg-emerald-500/[0.06]' : 'bg-transparent'
      }`}
    >
      {/* Question label + status indicator */}
      <div className="flex items-start gap-2 mb-1.5">
        {isAnswered ? (
          <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
        ) : (
          <CircleDot className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground/90 leading-snug">
          {question.question}
        </span>
      </div>

      {/* Context */}
      {question.context && (
        <div className="flex items-start gap-1.5 ml-5.5 mb-2">
          <Info className="w-3 h-3 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-muted-foreground/50 leading-relaxed">
            {question.context}
          </span>
        </div>
      )}

      {/* Input control */}
      <div className="ml-5.5">
        {question.type === 'select' && question.options ? (
          <SelectPills options={question.options} value={answer} onChange={onAnswer} allowCustom={question.allow_custom} />
        ) : question.type === 'boolean' ? (
          <BooleanToggle value={answer} onChange={onAnswer} />
        ) : question.type === 'devtools_project' ? (
          <DevToolsProjectDropdown
            value={answer || null}
            onSelect={(project) => onAnswer(project.id)}
            className="max-w-sm"
          />
        ) : question.type === 'textarea' ? (
          <textarea
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder={question.default ?? 'Describe in detail...'}
            rows={3}
            className="w-full max-w-lg px-3 py-2 text-sm rounded-lg border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all resize-y min-h-[60px]"
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder={question.default ?? 'Type your answer...'}
            className="w-full max-w-sm px-3 py-1.5 text-sm rounded-lg border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuestionnaireFormGrid({
  questions,
  userAnswers,
  onAnswerUpdated,
  onSubmit,
  onClose,
}: QuestionnaireFormGridProps) {
  const grouped = useMemo(() => groupByCategory(questions), [questions]);
  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const allAnswered = answeredCount === totalCount;
  const remaining = totalCount - answeredCount;

  // Auto-focus first unanswered text input on mount
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [firstUnansweredId] = useState(() => {
    const q = questions.find((q) => !userAnswers[q.id] && q.type === 'text');
    return q?.id ?? null;
  });

  useEffect(() => {
    const timer = setTimeout(() => firstInputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <BaseModal isOpen onClose={onClose} titleId="questionnaire-form-grid" size="6xl" portal>
      <div className="flex flex-col max-h-[85vh]">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-primary/80" />
              <h2 id="questionnaire-form-grid" className="text-lg font-semibold text-foreground">
                Configure Your Persona
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
          <ProgressBar answered={answeredCount} total={totalCount} />
        </div>

        {/* ── Scrollable grid ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            {categoryKeys.map((catKey) => {
              const meta = CATEGORY_META[catKey] ?? FALLBACK_CATEGORY;
              const qs = grouped[catKey]!;
              const { Icon } = meta;

              return (
                <motion.div
                  key={catKey}
                  variants={sectionVariants}
                  className={`rounded-xl border ${meta.border} ${meta.bg} overflow-hidden`}
                  style={{ borderLeftWidth: 3 }}
                >
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">
                      {qs.filter((q) => !!userAnswers[q.id]).length}/{qs.length}
                    </span>
                  </div>

                  {/* Questions */}
                  <div className="px-2 pb-3 space-y-1">
                    {qs.map((q) => (
                      <QuestionCard
                        key={q.id}
                        question={q}
                        answer={userAnswers[q.id] ?? ''}
                        onAnswer={(v) => onAnswerUpdated(q.id, v)}
                        inputRef={q.id === firstUnansweredId ? firstInputRef : undefined}
                      />
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!allAnswered}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl transition-all ${
              allAnswered
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
                : 'bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            {allAnswered ? 'Submit All' : `Submit All (${remaining} remaining)`}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
