import type { ReactNode } from 'react';
import type { JsonValue } from '@/lib/bindings/serde_json/JsonValue';
import type { UseCaseInputField } from '@/lib/types/frontendTypes';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { coerceParameterValue } from '../libs/charterSpec';

interface FieldArgs {
  field: UseCaseInputField;
  value: JsonValue;
  onChange: (next: JsonValue) => void;
}

/**
 * One control per declared field type, keyed BY that type rather than chosen by
 * an `=== 'boolean'` chain beside the renderer. The table is exhaustive over
 * `UseCaseInputField['type']`, so a kind added to the vocabulary
 * (`CAPABILITY_FIELD_TYPES`) fails to compile here until it has a control —
 * which is the difference between a vocabulary and a guess.
 */
const CONTROLS: Record<UseCaseInputField['type'], (args: FieldArgs) => ReactNode> = {
  boolean: ({ field, value, onChange }) => (
    <AccessibleToggle
      checked={value === true}
      onChange={() => onChange(value !== true)}
      label={field.label}
      data-testid={`resp-param-${field.key}`}
    />
  ),
  select: ({ field, value, onChange }) => (
    <ThemedSelect
      filterable
      hideSearch
      options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
      value={String(value ?? '')}
      onValueChange={(v) => onChange(v)}
      aria-label={field.label}
    />
  ),
  number: ({ field, value, onChange }) => (
    <input
      value={String(value ?? '')}
      inputMode="numeric"
      onChange={(e) => onChange(coerceParameterValue(field, e.target.value))}
      className={INPUT_FIELD}
      data-testid={`resp-param-${field.key}`}
    />
  ),
  text: ({ field, value, onChange }) => (
    <input
      value={String(value ?? '')}
      onChange={(e) => onChange(coerceParameterValue(field, e.target.value))}
      className={INPUT_FIELD}
      data-testid={`resp-param-${field.key}`}
    />
  ),
};

/** Control kinds that are only renderable when the declaration supplies
 *  `options`. Membership, not an `=== 'select'` test, so the exception stays
 *  part of the vocabulary rather than a literal beside the renderer. */
const OPTION_DEPENDENT: ReadonlySet<UseCaseInputField['type']> = new Set(['select']);

/** Label + the control the field's declared type asks for. */
export function CharterParameterField(args: FieldArgs) {
  // An option-dependent kind with no options has nothing to pick from — fall
  // back to free text rather than an empty dropdown nobody can answer.
  const kind: UseCaseInputField['type'] =
    OPTION_DEPENDENT.has(args.field.type) && (args.field.options?.length ?? 0) === 0
      ? 'text'
      : args.field.type;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="typo-title">{args.field.label}</span>
      {CONTROLS[kind](args)}
    </div>
  );
}
