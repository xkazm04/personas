import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { summarizeSourceDefinition } from '@/features/shared/components/forms/SourceDefinitionInput';
import type { useTranslation } from '@/i18n/useTranslation';
import type { QuestionnaireNormalizedOption } from './types';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function polar(angleRad: number, r: number) {
  return { x: Math.cos(angleRad) * r, y: Math.sin(angleRad) * r };
}

export function angleForIndex(i: number, total: number): number {
  if (total === 0) return 0;
  // Start at top (-π/2) and move clockwise
  return (i / total) * Math.PI * 2 - Math.PI / 2;
}

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
  if (parts.length === 2) return parts.join(' and ');
  return `${parts[0]}, ${parts[1]} +${parts.length - 2} more`;
}

// ---------------------------------------------------------------------------
// Option normalization
// ---------------------------------------------------------------------------

/** Templates author both shapes — plain strings OR `{value, label, description}`
 *  objects. Flatten both to a single `QuestionnaireNormalizedOption` so downstream widgets
 *  never need to guess. */
export function normalizeOptions(raw: unknown[] | undefined): QuestionnaireNormalizedOption[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((o) => {
    if (o && typeof o === 'object') {
      const obj = o as { value?: unknown; label?: unknown; description?: unknown };
      const value = typeof obj.value === 'string' ? obj.value : String(obj.value ?? '');
      const label = typeof obj.label === 'string' ? obj.label : value;
      const sublabel = typeof obj.description === 'string' ? obj.description : null;
      return { value, label, sublabel };
    }
    const s = String(o);
    return { value: s, label: s, sublabel: null };
  });
}

/** Options resolver for the numeric-keyboard handler + QuestionnaireStackedOptions.
 *  Returns an empty list for types we don't stack (text, dynamic, pickers, …). */
export function resolveStackableOptions(
  question: TransformQuestionResponse,
  filteredOptions?: string[],
): QuestionnaireNormalizedOption[] {
  if (question.type === 'boolean') {
    return [
      { value: 'yes', label: 'Yes', sublabel: null },
      { value: 'no', label: 'No', sublabel: null },
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
