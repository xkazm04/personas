/**
 * Sub-components used inside QuestionnaireFormGrid:
 *   - ProgressBar      — answered/total progress bar
 *   - DynamicSelectBody — loading/error/items states for dynamic_source questions
 *   - BooleanToggle    — yes/no toggle for boolean questions
 *   - QuestionCard     — single question row (exported for sibling adoption views)
 */
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Check, KeyRound,
  Info, CircleDot, AlertCircle, Plus, Loader2, RefreshCw, Zap,
} from 'lucide-react';
import { DevToolsProjectDropdown } from '@/features/shared/components/forms/DevToolsProjectDropdown';
import { DirectoryPickerInput } from '@/features/shared/components/forms/DirectoryPickerInput';
import { SourceDefinitionInput } from '@/features/shared/components/forms/SourceDefinitionInput';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from './useDynamicQuestionOptions';
import { useTranslation } from '@/i18n/useTranslation';
import { SelectPills } from './SelectPills';

// Re-export so importers that imported from this file still resolve
export { SelectPills } from './SelectPills';
export type { PillOption } from './SelectPills';

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const pct = total === 0 ? 0 : (answered / total) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <span className="typo-caption text-foreground tabular-nums whitespace-nowrap">
        {answered}/{total} answered
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DynamicSelectBody (private — only used by QuestionCard)
// ---------------------------------------------------------------------------

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
  const { t, tx } = useTranslation();
  const src = question.dynamic_source!;
  const state = dynamicState;

  if (!state) {
    return (
      <div className="flex items-center gap-2 typo-body text-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {t.templates.adopt_modal.preparing}
      </div>
    );
  }

  if (state.waitingOnParent) {
    return (
      <div className="flex items-center gap-2 typo-body text-foreground">
        <CircleDot className="w-3.5 h-3.5" />
        {t.templates.adopt_modal.waiting_for_parent}
      </div>
    );
  }

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 typo-body text-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {tx(t.templates.adopt_modal.loading_from_service, { service: src.service_type })}
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 typo-body text-status-error">
          <AlertCircle className="w-3.5 h-3.5" />
          {state.error}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card bg-foreground/[0.03] border border-border text-foreground hover:bg-foreground/[0.06] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t.templates.adopt_modal.retry}
          </button>
          {(() => {
            const categoryForAdd = question.vault_category
              ?? (src.source === 'vault' ? src.service_type : null);
            if (!categoryForAdd || !onAddCredential) return null;
            return (
              <button
                type="button"
                onClick={() => onAddCredential(categoryForAdd)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card bg-status-error/15 border border-status-error/30 text-status-error hover:bg-status-error/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t.templates.adopt_modal.add_credential}
              </button>
            );
          })()}
        </div>
        {/* Fallback: let the user type a value so adoption isn't fully blocked */}
        <input
          type="text"
          value={answer}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder={question.default ?? t.templates.adopt_modal.type_a_value}
          className="w-full max-w-sm px-3 py-1.5 text-sm rounded-card border border-border bg-foreground/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 focus:bg-foreground/[0.05] transition-all"
        />
      </div>
    );
  }

  if (state.ready && state.items.length === 0) {
    const isVaultSourced = src.source === 'vault';
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Info className="w-3.5 h-3.5" />
          {tx(t.templates.adopt_modal.no_items_found, {
            item: src.operation.replace('list_', ''),
            service: src.service_type,
          })}
        </div>
        {isVaultSourced && onAddCredential && (
          <button
            type="button"
            onClick={() => onAddCredential(src.service_type)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card bg-primary/15 border border-primary/30 text-foreground hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t.templates.adopt_modal.add_credential}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-status-success/80">
        <Zap className="w-3 h-3" />
        {tx(t.templates.adopt_modal.loaded_live_from, { service: src.service_type })}
      </div>
      <SelectPills
        options={state.items.map((i) => ({ value: i.value, label: i.label, sublabel: i.sublabel }))}
        value={answer}
        onChange={onAnswer}
        multi={src.multi}
        includeAllOption={src.include_all_option}
        allowCustom
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BooleanToggle (private — only used by QuestionCard)
// ---------------------------------------------------------------------------

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
            className={`flex-1 px-3 py-1.5 text-xs rounded-card border transition-all ${
              selected
                ? opt === 'Yes'
                  ? 'bg-status-success/15 border-status-success/30 text-status-success font-medium'
                  : 'bg-status-error/15 border-status-error/30 text-status-error font-medium'
                : 'bg-foreground/[0.03] border-border text-foreground hover:bg-foreground/[0.06]'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionCard
// ---------------------------------------------------------------------------

export function QuestionCard({
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
  const [pulseKey, setPulseKey] = useState(0);
  const [tipOpen, setTipOpen] = useState(false);
  const prevAnswer = useRef(answer);

  // Free-text inputs emit a new answer on every keystroke — don't flash
  // the green pulse for those, it would strobe while the user is typing.
  // Only pills, booleans, and structured pickers trigger the celebration.
  const isFreeText =
    question.type === 'text' ||
    question.type === 'textarea' ||
    question.type === 'source_definition';

  useEffect(() => {
    if (isFreeText) {
      prevAnswer.current = answer;
      return;
    }
    if (answer && answer !== prevAnswer.current) {
      // Bumping the key remounts the pulse overlay so the radial wave
      // animation replays from scratch each time the answer changes.
      setPulseKey((k) => k + 1);
      prevAnswer.current = answer;
      return;
    }
    prevAnswer.current = answer;
  }, [answer, isFreeText]);

  const isAnswered = !!answer;
  const hasTip = !!question.context && !isBlocked;

  return (
    <div
      className={`relative overflow-hidden rounded-card px-3 py-2.5 transition-colors ${
        isBlocked ? 'bg-status-error/10 border border-status-error/20' : 'bg-transparent'
      }`}
    >
      {/* Radial green pulse wave — emanates from the center to the edges when
          a fresh answer commits. The key prop forces a remount so every answer
          change replays the animation. */}
      {pulseKey > 0 && !isBlocked && (
        <span
          key={pulseKey}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-answer-pulse"
          style={{
            background:
              'radial-gradient(circle at center, rgba(16,185,129,0.28) 0%, rgba(16,185,129,0.12) 40%, transparent 75%)',
          }}
        />
      )}
      {/* Question label + status indicator + collapsible tip toggle.
          `mb-4` gives the question room to breathe before the answer row. */}
      <div className="flex items-start gap-2 mb-4">
        {isBlocked ? (
          <AlertCircle className="w-5 h-5 text-status-error mt-1 flex-shrink-0" />
        ) : isAnswered ? (
          <Check className="w-5 h-5 text-status-success mt-1 flex-shrink-0" />
        ) : (
          <CircleDot className="w-5 h-5 text-status-warning/70 mt-1 flex-shrink-0" />
        )}
        <span className="flex-1 text-xl font-medium text-foreground/90 leading-snug">
          {question.question}
        </span>
        {isAutoDetected && !isBlocked && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-brand-purple/10 border border-brand-purple/30 text-brand-purple flex-shrink-0 mt-0.5">
            <KeyRound className="w-3 h-3" />
            {t.templates.adopt_modal.auto_detected}
          </span>
        )}
        {hasTip && (
          <button
            type="button"
            onClick={() => setTipOpen((v) => !v)}
            aria-expanded={tipOpen}
            aria-label={tipOpen ? t.templates.adopt_modal.hide_explanation : t.templates.adopt_modal.show_explanation}
            className={`flex-shrink-0 mt-0.5 p-0.5 rounded transition-colors ${
              tipOpen
                ? 'text-primary/80 hover:text-primary'
                : 'text-foreground hover:text-muted-foreground/70'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Context — collapsed by default, expands on Info icon click */}
      {hasTip && tipOpen && (
        <div className="ml-5.5 mb-2 px-2.5 py-1.5 rounded-input bg-foreground/[0.02] border border-border">
          <span className="text-sm text-foreground leading-relaxed">
            {question.context}
          </span>
        </div>
      )}

      {/* Blocked state: show the "Add credential" call-to-action */}
      {isBlocked && question.vault_category ? (
        <div className="ml-5.5 space-y-2">
          <p className="text-xs text-status-error/80 leading-relaxed">
            {t.templates.adopt_modal.credential_required.replace('{category}', question.vault_category)}
          </p>
          <button
            type="button"
            onClick={() => onAddCredential?.(question.vault_category!)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-card bg-status-error/15 border border-status-error/30 text-status-error hover:bg-status-error/25 transition-colors"
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
            options={(filteredOptions ?? question.options).map((o) => {
              // Templates authored both shapes over time:
              //  - plain strings (e.g. ["Low", "Medium", "High"])
              //  - {value, label, description?} objects (9 templates in the catalog)
              // Accept either so the adoption UI never crashes on object options.
              if (o && typeof o === 'object') {
                const obj = o as { value?: unknown; label?: unknown; description?: unknown };
                const value = typeof obj.value === 'string' ? obj.value : String(obj.value ?? '');
                const label = typeof obj.label === 'string' ? obj.label : value;
                const sublabel =
                  typeof obj.description === 'string' ? obj.description : null;
                return { value, label, sublabel };
              }
              const s = String(o);
              return { value: s, label: s };
            })}
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
            placeholder={question.default ?? t.templates.adopt_modal.select_directory}
          />
        ) : question.type === 'source_definition' ? (
          <SourceDefinitionInput
            value={answer}
            onChange={onAnswer}
            localPlaceholder={question.default || undefined}
          />
        ) : question.type === 'textarea' ? (
          <textarea
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder={question.default ?? t.templates.adopt_modal.describe_in_detail}
            rows={3}
            className="w-full max-w-lg px-3 py-2 typo-body rounded-card border border-border bg-foreground/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 focus:bg-foreground/[0.05] transition-all resize-y min-h-[60px]"
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder={question.default ?? t.templates.adopt_modal.type_your_answer}
            className="w-full max-w-sm px-3 py-1.5 typo-body rounded-card border border-border bg-foreground/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 focus:bg-foreground/[0.05] transition-all"
          />
        )}
      </div>
      )}
      {!isBlocked && (() => {
        const ids = question.use_case_ids ?? (question.use_case_id ? [question.use_case_id] : []);
        if (ids.length === 0) return null;
        return (
          <div className="mt-1.5 typo-body text-foreground/55 italic">
            Applies to: {ids.join(', ')}
          </div>
        );
      })()}
    </div>
  );
}
