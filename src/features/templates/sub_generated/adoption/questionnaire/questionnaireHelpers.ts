import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { summarizeSourceDefinition } from '@/features/templates/components/SourceDefinitionInput';
import { getActiveTranslations, interpolate, type useTranslation } from '@/i18n/useTranslation';
import type { QuestionnaireNormalizedOption } from './types';

// ---------------------------------------------------------------------------
// Answer summary — used by the thread rail
// ---------------------------------------------------------------------------

export function summarizeAnswer(
  raw: string,
  questionType?: TransformQuestionResponse['type'],
  t?: ReturnType<typeof useTranslation>['t'],
): string {
  if (!raw) return '';
  if (questionType === 'source_definition') return summarizeSourceDefinition(raw, t);
  if (raw === 'all') return t?.templates.adopt_modal.all_option ?? 'All';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? raw;
  // The conjunction and the overflow suffix are grammar, not punctuation —
  // locales order and word them differently — so the whole sentence shape
  // lives in the catalog rather than being assembled here. The English
  // literals are the no-`t` fallback only (same shape as `all_option`
  // above); the single live call site always threads `t` through.
  const first = parts[0]!;
  const second = parts[1]!;
  if (parts.length === 2) {
    const tpl = t?.templates.adopt_modal.answer_list_pair;
    return tpl ? interpolate(tpl, { first, second }) : `${first} and ${second}`;
  }
  const count = parts.length - 2;
  const tpl = t?.templates.adopt_modal.answer_list_overflow;
  return tpl
    ? interpolate(tpl, { first, second, count })
    : `${first}, ${second} +${count} more`;
}

// ---------------------------------------------------------------------------
// Option normalization
// ---------------------------------------------------------------------------

/**
 * Coerce an authored option value to the answer string the payload mapping
 * consumes, or `null` when it cannot be one.
 *
 * Only scalars survive. A nested object or array has no string form a user
 * could have meant — `String({})` is `"[object Object]"`, which used to
 * render as a selectable card and then get stored verbatim as the answer.
 * `null`/`undefined`/empty are equally unusable: they produce a blank,
 * indistinguishable card.
 */
function coerceOptionValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** Templates author both shapes — plain strings OR `{value, label, description}`
 *  objects. Flatten both to a single `QuestionnaireNormalizedOption` so downstream widgets
 *  never need to guess.
 *
 *  Templates come from generators as well as by hand, and this is the single
 *  normalisation door both adoption surfaces pass through, so a malformed
 *  option is DROPPED here rather than rendered. Shipping it forward would put
 *  an unpickable card in front of the user and corrupt the stored answer. */
export function normalizeOptions(raw: unknown[] | undefined): QuestionnaireNormalizedOption[] {
  if (!raw || raw.length === 0) return [];
  const dropped: unknown[] = [];
  const out = raw.flatMap<QuestionnaireNormalizedOption>((o) => {
    if (o && typeof o === 'object') {
      const obj = o as { value?: unknown; label?: unknown; description?: unknown };
      const value = coerceOptionValue(obj.value);
      if (value === null) {
        dropped.push(o);
        return [];
      }
      const label = typeof obj.label === 'string' && obj.label.trim() ? obj.label : value;
      const sublabel = typeof obj.description === 'string' ? obj.description : null;
      return [{ value, label, sublabel }];
    }
    const s = coerceOptionValue(o);
    if (s === null) {
      dropped.push(o);
      return [];
    }
    return [{ value: s, label: s, sublabel: null }];
  });
  if (dropped.length > 0) {
    // Surfacing beats swallowing: a template that authors an unusable option
    // is an authoring defect, and the questionnaire is the only place it shows.
    console.warn(
      `[adoption] normalizeOptions dropped ${dropped.length} option(s) with no usable scalar value`,
      dropped,
    );
  }
  return out;
}

/** Options resolver for the numeric-keyboard handler + QuestionnaireStackedOptions.
 *  Returns an empty list for types we don't stack (text, dynamic, pickers, …). */
export function resolveStackableOptions(
  question: TransformQuestionResponse,
  filteredOptions?: string[],
): QuestionnaireNormalizedOption[] {
  if (question.type === 'boolean') {
    // Non-React helper: `getActiveTranslations()` is the sanctioned door for
    // localized strings outside a component (CLAUDE.md § i18n). Both live
    // call sites (AdoptionAnswerCard, QuestionnaireForm) invoke this during
    // render of a `useTranslation()` subscriber, so a language switch
    // re-derives these labels.
    const t = getActiveTranslations();
    return [
      { value: 'yes', label: t.recipes.yes, sublabel: null },
      { value: 'no', label: t.recipes.no, sublabel: null },
    ];
  }
  if (question.type === 'select') {
    const raw = filteredOptions ?? question.options ?? [];
    return normalizeOptions(raw);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Stackability test
// ---------------------------------------------------------------------------

/** A question qualifies for stacked-card rendering (with keyboard numbers)
 *  when it's a fixed-option single-select or a boolean. Dynamic options,
 *  allow-custom selects, and free-text types fall through to QuestionCard. */
export function isStackable(q: TransformQuestionResponse, optCount: number): boolean {
  if (q.dynamic_source) return false;
  if (q.type === 'boolean') return true;
  if (q.type === 'select') {
    if (q.allow_custom) return false;
    return optCount > 0;
  }
  return false;
}
