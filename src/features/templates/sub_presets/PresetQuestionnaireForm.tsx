import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Settings2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import type { PresetAdoptionSchema } from '@/lib/bindings/PresetAdoptionSchema';
import type { PresetMemberAdoptionSchema } from '@/lib/bindings/PresetMemberAdoptionSchema';
import type { PresetParameterOverrides } from '@/api/templates/teamPresets';

/**
 * Narrow local view of the `adoption_questions[]` shape that ships
 * inside each `PresetMemberAdoptionSchema.questions` entry. The Rust
 * binding types these as `any` (see PresetMemberAdoptionSchema rationale
 * — questions are passthrough JSON values from the template's design
 * file). This is the same shape ChronologyAdoptionView consumes for the
 * single-template adoption flow; we narrow it here for type-checked
 * rendering without leaking the broader template schema into this
 * file's surface.
 */
interface AdoptionQuestion {
  id: string;
  variable_name?: string;
  label?: string;
  context?: string;
  type?: 'text' | 'string' | 'select' | 'number' | 'boolean' | string;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
}

interface PresetQuestionnaireFormProps {
  schema: PresetAdoptionSchema;
  value: PresetParameterOverrides;
  onChange: (next: PresetParameterOverrides) => void;
  /**
   * Set of roles currently expanded. Stored at the parent so toggling
   * doesn't reset on re-render and the "Expand all" / "Collapse all"
   * affordances can drive it from outside if needed.
   */
  expandedRoles: Set<string>;
  onToggleRole: (role: string) => void;
}

/**
 * Combined questionnaire form rendered inside `PresetPreviewModal`
 * when the user clicks "Customize first." Each preset member becomes
 * one collapsible section; questions render with appropriate controls
 * for their declared `type` (select / number / boolean / text).
 *
 * Design rules:
 *   - Sections collapsed by default — for a 6-member preset with ~40
 *     questions, expanding everything up-front would overwhelm. User
 *     only opens what they intend to change. The summary line shows
 *     question count + whether any overrides have been applied so
 *     they can see at-a-glance which sections they've touched.
 *   - Empty `questions` arrays render a "no config needed" hint, not
 *     a missing section — keeps the full member list visible so the
 *     user can verify they understand what each role does.
 *   - Each control echoes the override value if set, otherwise the
 *     template default — there's no separate "reset this field"
 *     control; clearing back to the default value just removes the
 *     override at the parent and the field re-displays the default.
 *   - Validation is intentionally minimal here: HTML5 attributes for
 *     numeric min/max, that's it. Server-side normalization handles
 *     type coercion (see `instant_adopt_template_inner`'s answers
 *     conversion), so an out-of-range number or a misspelled select
 *     value isn't a crash — it just falls back to the template
 *     default at adopt time. A future cycle can add inline error
 *     messages once we see which mistakes actually happen in
 *     practice.
 */
export function PresetQuestionnaireForm({
  schema,
  value,
  onChange,
  expandedRoles,
  onToggleRole,
}: PresetQuestionnaireFormProps) {
  const { t, tx } = useTranslation();

  const setMemberOverride = useCallback(
    (role: string, questionId: string, newVal: unknown) => {
      const memberMap = { ...(value[role] ?? {}) };
      const memberQuestions = (schema.members.find((m) => m.role === role)
        ?.questions ?? []) as unknown as AdoptionQuestion[];
      const defaultVal = memberQuestions.find((q) => q.id === questionId);
      // If the user typed the field back to its template default,
      // remove the override entry so the wire payload stays minimal
      // and a future "no overrides" UI summary stays honest.
      if (
        defaultVal &&
        (newVal === defaultVal.default ||
          (typeof newVal === 'string' &&
            String(defaultVal.default ?? '') === newVal))
      ) {
        delete memberMap[questionId];
      } else {
        memberMap[questionId] = newVal;
      }

      const next = { ...value };
      if (Object.keys(memberMap).length === 0) {
        delete next[role];
      } else {
        next[role] = memberMap;
      }
      onChange(next);
    },
    [value, schema, onChange],
  );

  return (
    <section
      className="rounded-card border border-primary/15 bg-secondary/10 px-3 py-3 space-y-2"
      data-testid="preset-questionnaire-form"
    >
      <header className="flex items-center gap-2 pb-1 border-b border-primary/10">
        <Settings2 className="w-4 h-4 text-foreground/70" />
        <h3 className="typo-label uppercase tracking-wider text-foreground/80 flex-1">
          {t.templates.presets.questionnaire_heading}
        </h3>
        <span className="typo-caption text-foreground/60">
          {tx(t.templates.presets.questionnaire_summary, {
            configurable: schema.configurable_member_count,
            total: schema.member_count,
            questions: schema.total_question_count,
          })}
        </span>
      </header>

      {schema.members.map((member) => (
        <MemberSection
          key={member.role}
          member={member}
          expanded={expandedRoles.has(member.role)}
          onToggle={() => onToggleRole(member.role)}
          overrides={value[member.role] ?? {}}
          onSetOverride={(qid, v) => setMemberOverride(member.role, qid, v)}
        />
      ))}
    </section>
  );
}

interface MemberSectionProps {
  member: PresetMemberAdoptionSchema;
  expanded: boolean;
  onToggle: () => void;
  overrides: Record<string, unknown>;
  onSetOverride: (questionId: string, value: unknown) => void;
}

function MemberSection({
  member,
  expanded,
  onToggle,
  overrides,
  onSetOverride,
}: MemberSectionProps) {
  const { t, tx } = useTranslation();
  const questions = member.questions as unknown as AdoptionQuestion[];
  const overrideCount = Object.keys(overrides).length;
  const hasQuestions = questions.length > 0;

  return (
    <div
      className={`rounded-card border bg-background/40 transition-colors ${
        expanded && hasQuestions ? 'border-primary/20' : 'border-primary/10'
      }`}
    >
      <button
        type="button"
        data-testid={`preset-questionnaire-member-${member.role}`}
        onClick={hasQuestions ? onToggle : undefined}
        disabled={!hasQuestions}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/15 disabled:cursor-default disabled:hover:bg-transparent rounded-card"
        aria-expanded={expanded}
        aria-label={
          hasQuestions
            ? expanded
              ? t.templates.presets.questionnaire_collapse_section
              : t.templates.presets.questionnaire_expand_section
            : undefined
        }
      >
        {hasQuestions ? (
          <ChevronRight
            className={`w-3.5 h-3.5 text-foreground/60 flex-shrink-0 transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <span className="typo-body font-medium text-foreground/90 uppercase tracking-wider text-[11px] min-w-[100px]">
          {member.role}
        </span>
        <span className="typo-body text-foreground/80 flex-1 truncate">
          {member.template_name}
        </span>
        <span className="typo-caption text-foreground/50 flex-shrink-0">
          {hasQuestions
            ? overrideCount > 0
              ? tx(t.templates.presets.questionnaire_member_summary_customized, {
                  count: questions.length,
                  customized: overrideCount,
                })
              : tx(t.templates.presets.questionnaire_member_summary_default, {
                  count: questions.length,
                })
            : t.templates.presets.questionnaire_member_no_config}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasQuestions && (
          <motion.div
            key="member-questions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-2 space-y-3 border-t border-primary/10">
              {member.template_description && (
                <p className="typo-caption text-foreground/55 italic leading-relaxed">
                  {member.template_description}
                </p>
              )}
              {questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={overrides[q.id]}
                  onChange={(v) => onSetOverride(q.id, v)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface QuestionFieldProps {
  question: AdoptionQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}

function QuestionField({ question, value, onChange }: QuestionFieldProps) {
  const label = question.label ?? question.variable_name ?? question.id;
  const hint = question.context;
  const effectiveValue = value ?? question.default;
  const typeLower = (question.type ?? 'text').toLowerCase();

  return (
    <div data-testid={`preset-question-${question.id}`} className="space-y-1">
      <label className="typo-label text-foreground/85 block">{label}</label>
      {hint && <p className="typo-caption text-foreground/55">{hint}</p>}
      {typeLower === 'select' && Array.isArray(question.options) ? (
        <SelectControl
          options={question.options}
          value={effectiveValue}
          onChange={onChange}
        />
      ) : typeLower === 'boolean' ? (
        <BooleanControl value={effectiveValue} onChange={onChange} />
      ) : typeLower === 'number' ? (
        <NumberControl
          value={effectiveValue}
          min={question.min}
          max={question.max}
          unit={question.unit}
          onChange={onChange}
        />
      ) : (
        <TextControl value={effectiveValue} onChange={onChange} />
      )}
    </div>
  );
}

function SelectControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <select
      className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground/90 typo-body px-2 py-1.5 focus:outline-none focus:border-primary/60"
      value={typeof value === 'string' ? value : String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function BooleanControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const checked =
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1' ||
    value === 'yes';
  return (
    <label className="inline-flex items-center gap-2 typo-body text-foreground/80 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded-input border border-primary/40 bg-secondary/20"
      />
      <span>{checked ? 'On' : 'Off'}</span>
    </label>
  );
}

function NumberControl({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  value: unknown;
  min?: number;
  max?: number;
  unit?: string;
  onChange: (v: unknown) => void;
}) {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return (
    <div className="flex items-center gap-2">
      <NumberStepper
        value={Number.isFinite(num) ? num : null}
        onChange={(v) => onChange(v ?? 0)}
        min={min}
        max={max}
        allowEmpty
        suffix={unit}
        className="w-36"
      />
    </div>
  );
}

function TextControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <input
      type="text"
      className="w-full rounded-input bg-secondary/30 border border-primary/20 text-foreground/90 typo-body px-2 py-1.5 focus:outline-none focus:border-primary/60"
      value={typeof value === 'string' ? value : String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Standalone affordance — Expand all / Collapse all — kept separate
 * from the form body so the modal can render it next to the
 * "Customize first" toggle in the footer rather than competing for
 * space inside the form header. Returns null when there's nothing
 * configurable to act on.
 */
export function PresetQuestionnaireBulkControls({
  schema,
  expandedRoles,
  onSetAllExpanded,
}: {
  schema: PresetAdoptionSchema;
  expandedRoles: Set<string>;
  onSetAllExpanded: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const configurableRoles = schema.members
    .filter((m) => m.questions.length > 0)
    .map((m) => m.role);
  if (configurableRoles.length === 0) return null;
  const allExpanded = configurableRoles.every((r) => expandedRoles.has(r));
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (allExpanded) {
          onSetAllExpanded(new Set());
        } else {
          onSetAllExpanded(new Set(configurableRoles));
        }
      }}
    >
      {allExpanded
        ? t.templates.presets.questionnaire_collapse_all
        : t.templates.presets.questionnaire_expand_all}
    </Button>
  );
}
