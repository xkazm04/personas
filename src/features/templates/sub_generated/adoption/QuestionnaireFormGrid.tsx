import { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Send, Check, X, Sparkles,
  KeyRound, Settings2, ShieldCheck, Brain, Bell, Globe, Gauge,
  Info, CircleDot, AlertCircle, Plus, Loader2, RefreshCw, Zap,
} from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { DevToolsProjectDropdown } from '@/features/shared/components/forms/DevToolsProjectDropdown';
import { DirectoryPickerInput } from '@/features/shared/components/forms/DirectoryPickerInput';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionnaireFormGridProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  /** Question IDs that were auto-answered from the credential vault. */
  autoDetectedIds?: Set<string>;
  /** Question IDs that are blocked because no vault credential exists for the category. */
  blockedQuestionIds?: Set<string>;
  /** Vault-narrowed option lists per question ID. Applied when 2+ credentials match. */
  filteredOptions?: Record<string, string[]>;
  /**
   * Per-question state from `useDynamicQuestionOptions` — populated for any
   * question whose template JSON carries a `dynamic_source`. Covers loading,
   * error, and the actual list of `{value, label, sublabel}` items fetched
   * from the backing connector (Sentry, codebases, ...).
   */
  dynamicOptions?: Record<string, DynamicOptionState>;
  /** Retry the dynamic fetch for a specific question id. */
  onRetryDynamic?: (questionId: string) => void;
  /** Called when the user clicks "Add credential" on a blocked question. Passes the vault category. */
  onAddCredential?: (vaultCategory: string) => void;
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

interface PillOption {
  value: string;
  label: string;
  sublabel?: string | null;
}

// Multi-select values are stored CSV-encoded so the existing answer map
// (`Record<string,string>`) keeps working. The literal string "all" is the
// sentinel for "include_all_option" selections — easier to match than the
// empty string and survives round-tripping to templates unchanged.
const ALL_SENTINEL = 'all';
function parseCsv(v: string): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
function toCsv(values: string[]): string {
  return values.join(',');
}

function SelectPills({
  options,
  value,
  onChange,
  allowCustom,
  multi,
  includeAllOption,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
  allowCustom?: boolean;
  multi?: boolean;
  includeAllOption?: boolean;
}) {
  const { t } = useTranslation();
  const selectedValues = useMemo(
    () => (multi ? new Set(parseCsv(value)) : new Set([value])),
    [value, multi],
  );
  const isAllSelected = multi && (value === ALL_SENTINEL || selectedValues.has(ALL_SENTINEL));

  const isCustomValue =
    !multi && allowCustom && value && !options.some((o) => o.value === value);
  const [showCustomInput, setShowCustomInput] = useState(isCustomValue ?? false);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCustomInput) {
      setTimeout(() => customInputRef.current?.focus(), 50);
    }
  }, [showCustomInput]);

  const togglePill = (optValue: string) => {
    setShowCustomInput(false);
    if (!multi) {
      onChange(optValue);
      return;
    }
    // Multi-select: toggle membership. Picking a real option clears "all".
    const next = new Set(selectedValues);
    next.delete(ALL_SENTINEL);
    if (next.has(optValue)) next.delete(optValue);
    else next.add(optValue);
    onChange(toCsv([...next]));
  };

  const pickAll = () => {
    setShowCustomInput(false);
    onChange(ALL_SENTINEL);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {multi && includeAllOption && (
          <button
            type="button"
            onClick={pickAll}
            className={`px-3.5 py-1.5 text-base rounded-lg border transition-all ${
              isAllSelected
                ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                : 'bg-white/[0.03] border-white/[0.06] text-foreground/70 hover:bg-white/[0.06] hover:border-white/[0.1]'
            }`}
          >
            All
          </button>
        )}
        {options.map((opt) => {
          const selected =
            !showCustomInput &&
            !isAllSelected &&
            (multi ? selectedValues.has(opt.value) : value === opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => togglePill(opt.value)}
              className={`px-3.5 py-1.5 text-base rounded-lg border transition-all ${
                selected
                  ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                  : 'bg-white/[0.03] border-white/[0.06] text-foreground/70 hover:bg-white/[0.06] hover:border-white/[0.1]'
              }`}
              title={opt.sublabel ?? undefined}
            >
              {opt.label}
            </button>
          );
        })}
        {!multi && allowCustom && (
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
      {!multi && allowCustom && showCustomInput && (
        <input
          ref={customInputRef}
          type="text"
          value={isCustomValue ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.templates.adopt_modal.type_custom_value}
          className="w-full max-w-sm px-3 py-1.5 text-sm rounded-lg border border-primary/20 bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      )}
    </div>
  );
}

function DynamicSelectBody({
  question,
  answer,
  onAnswer,
  dynamicState,
  onRetry,
  onAddCredential,
}: {
  question: TransformQuestionResponse;
  answer: string;
  onAnswer: (v: string) => void;
  dynamicState?: DynamicOptionState;
  onRetry: () => void;
  onAddCredential?: (vaultCategory: string) => void;
}) {
  const src = question.dynamic_source!;
  const state = dynamicState;

  if (!state || state.waitingOnParent) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
        <CircleDot className="w-3.5 h-3.5" />
        Waiting for earlier answer…
      </div>
    );
  }

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading options from {src.service_type}…
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-rose-300/80">
          <AlertCircle className="w-3.5 h-3.5" />
          {state.error}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.03] border border-white/[0.1] text-foreground/80 hover:bg-white/[0.06] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
          {question.vault_category && onAddCredential && (
            <button
              type="button"
              onClick={() => onAddCredential(question.vault_category!)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add credential
            </button>
          )}
        </div>
        {/* Fallback: let the user type a value so adoption isn't fully blocked */}
        <input
          type="text"
          value={answer}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder={question.default ?? 'Type a value…'}
          className="w-full max-w-sm px-3 py-1.5 text-sm rounded-lg border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
        />
      </div>
    );
  }

  if (state.ready && state.items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
        <Info className="w-3.5 h-3.5" />
        No {src.operation.replace('list_', '')} found. Create one in {src.service_type} first.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-emerald-400/70">
        <Zap className="w-3 h-3" />
        Loaded live from {src.service_type}
      </div>
      <SelectPills
        options={state.items.map((i) => ({ value: i.value, label: i.label, sublabel: i.sublabel }))}
        value={answer}
        onChange={onAnswer}
        multi={src.multi}
        includeAllOption={src.include_all_option}
      />
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
  isAutoDetected,
  isBlocked,
  onAddCredential,
  filteredOptions,
  dynamicState,
  onRetryDynamic,
}: {
  question: TransformQuestionResponse;
  answer: string;
  onAnswer: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  isAutoDetected?: boolean;
  isBlocked?: boolean;
  onAddCredential?: (vaultCategory: string) => void;
  /** Vault-narrowed options for this question (overrides question.options). */
  filteredOptions?: string[];
  /** Live state for questions with a dynamic_source (loading/error/items). */
  dynamicState?: DynamicOptionState;
  /** Retry a failed dynamic fetch for this question. */
  onRetryDynamic?: (questionId: string) => void;
}) {
  const { t } = useTranslation();
  const [flash, setFlash] = useState(false);
  const prevAnswer = useRef(answer);

  useEffect(() => {
    if (answer && answer !== prevAnswer.current) {
      setFlash(true);
      const t2 = setTimeout(() => setFlash(false), 500);
      prevAnswer.current = answer;
      return () => clearTimeout(t2);
    }
    prevAnswer.current = answer;
  }, [answer]);

  const isAnswered = !!answer;

  return (
    <div
      className={`relative rounded-lg px-3 py-2.5 transition-colors ${
        flash ? 'bg-emerald-500/[0.06]' : isBlocked ? 'bg-rose-500/[0.04] border border-rose-500/15' : 'bg-transparent'
      }`}
    >
      {/* Question label + status indicator */}
      <div className="flex items-start gap-2 mb-1.5">
        {isBlocked ? (
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
        ) : isAnswered ? (
          <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
        ) : (
          <CircleDot className="w-3.5 h-3.5 text-amber-400/60 mt-0.5 flex-shrink-0" />
        )}
        <span className="text-base font-medium text-foreground/90 leading-snug">
          {question.question}
        </span>
        {isAutoDetected && !isBlocked && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 flex-shrink-0 mt-0.5">
            <KeyRound className="w-3 h-3" />
            {t.templates.adopt_modal.auto_detected}
          </span>
        )}
      </div>

      {/* Context */}
      {question.context && !isBlocked && (
        <div className="flex items-start gap-1.5 ml-5.5 mb-2">
          <Info className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
          <span className="text-sm text-muted-foreground/70 leading-relaxed">
            {question.context}
          </span>
        </div>
      )}

      {/* Blocked state: show the "Add credential" call-to-action */}
      {isBlocked && question.vault_category ? (
        <div className="ml-5.5 space-y-2">
          <p className="text-xs text-rose-300/80 leading-relaxed">
            {t.templates.adopt_modal.credential_required.replace('{category}', question.vault_category)}
          </p>
          <button
            type="button"
            onClick={() => onAddCredential?.(question.vault_category!)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t.templates.adopt_modal.add_credential}
          </button>
        </div>
      ) : (
      /* Input control */
      <div className="ml-5.5">
        {question.dynamic_source ? (
          <DynamicSelectBody
            question={question}
            answer={answer}
            onAnswer={onAnswer}
            dynamicState={dynamicState}
            onRetry={() => onRetryDynamic?.(question.id)}
            onAddCredential={onAddCredential}
          />
        ) : question.type === 'select' && question.options ? (
          <SelectPills
            options={(filteredOptions ?? question.options).map((o) => ({ value: o, label: o }))}
            value={answer}
            onChange={onAnswer}
            allowCustom={question.allow_custom}
          />
        ) : question.type === 'boolean' ? (
          <BooleanToggle value={answer} onChange={onAnswer} />
        ) : question.type === 'devtools_project' ? (
          <DevToolsProjectDropdown
            value={answer || null}
            onSelect={(project) => onAnswer(project.id)}
            className="max-w-sm"
          />
        ) : question.type === 'directory_picker' ? (
          <DirectoryPickerInput
            value={answer}
            onChange={onAnswer}
            placeholder={question.default ?? 'Select a directory...'}
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuestionnaireFormGrid({
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
  onClose,
}: QuestionnaireFormGridProps) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupByCategory(questions), [questions]);
  const categoryKeys = useMemo(() => Object.keys(grouped), [grouped]);

  const answeredCount = useMemo(
    () => questions.filter((q) => !!userAnswers[q.id]).length,
    [questions, userAnswers],
  );
  const totalCount = questions.length;
  const blockedCount = blockedQuestionIds?.size ?? 0;
  const allAnswered = answeredCount === totalCount;
  const canSubmit = allAnswered && blockedCount === 0;
  const remaining = totalCount - answeredCount;

  // Collect unique vault categories from blocked questions for the top callout
  const blockedCategories = useMemo(() => {
    if (!blockedQuestionIds || blockedQuestionIds.size === 0) return [];
    const seen = new Set<string>();
    const out: { category: string; questionLabels: string[] }[] = [];
    for (const q of questions) {
      if (!blockedQuestionIds.has(q.id) || !q.vault_category) continue;
      if (seen.has(q.vault_category)) {
        const existing = out.find((c) => c.category === q.vault_category);
        existing?.questionLabels.push(q.question);
      } else {
        seen.add(q.vault_category);
        out.push({ category: q.vault_category, questionLabels: [q.question] });
      }
    }
    return out;
  }, [questions, blockedQuestionIds]);

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
                {t.templates.adopt_modal.configure_your_persona}
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
          {/* Prominent blocked-state callout — shown when any required vault
              category has no matching credentials in the user's vault */}
          {blockedCategories.length > 0 && onAddCredential && (
            <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-4">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-rose-300 mb-1">
                    {t.templates.adopt_modal.credentials_required_title}
                  </h3>
                  <p className="text-sm text-rose-300/80 leading-relaxed">
                    {t.templates.adopt_modal.credentials_required_body}
                  </p>
                </div>
              </div>
              <div className="space-y-2 ml-8">
                {blockedCategories.map(({ category, questionLabels }) => (
                  <div key={category} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-rose-500/[0.04] border border-rose-500/15">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground/90 capitalize">{category}</div>
                      <div className="text-xs text-muted-foreground/60 truncate">
                        {questionLabels.join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddCredential(category)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30 transition-colors flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t.templates.adopt_modal.add_credential}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                        isAutoDetected={autoDetectedIds?.has(q.id)}
                        isBlocked={blockedQuestionIds?.has(q.id)}
                        onAddCredential={onAddCredential}
                        filteredOptions={filteredOptions?.[q.id]}
                        dynamicState={dynamicOptions?.[q.id]}
                        onRetryDynamic={onRetryDynamic}
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
            {t.templates.adopt_modal.cancel}
          </button>

          <div className="flex items-center gap-3">
            {blockedCount > 0 && (
              <span className="text-xs text-rose-300/70 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {t.templates.adopt_modal.blocked_blocking_submit.replace('{count}', String(blockedCount))}
              </span>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-xl transition-all ${
                canSubmit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
                  : 'bg-white/[0.06] text-muted-foreground/40 cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {allAnswered ? t.templates.adopt_modal.submit_all : t.templates.adopt_modal.submit_remaining.replace('{remaining}', String(remaining))}
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
