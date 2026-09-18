import type { FormFieldInputProps } from './FormField';

/** The accessible attributes a control actually renders onto its focusable node. */
export interface MergedFieldInputProps {
  id?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Combine the wiring a surrounding `FormField` injected with whatever the
 * control knows about itself.
 *
 * Specialized controls (a path field with its own dialog-failure notice, a hex
 * input with its own format error) already set `aria-invalid` and point at
 * their own message. Spreading FormField's props over them would silently drop
 * one of the two; merging keeps both - the field is invalid if EITHER says so,
 * and the description names every message that applies, in FormField-first
 * order so a screen reader reads the field's own error before the control's.
 *
 * Without this, a control can only join FormField's vocabulary by giving up its
 * own, which is why the specialized controls stayed outside it.
 */
export function mergeFieldInputProps(
  fromField: Partial<FormFieldInputProps> | undefined,
  own: { invalid?: boolean; describedBy?: string } = {},
): MergedFieldInputProps {
  const describedBy = [fromField?.['aria-describedby'], own.describedBy]
    .filter((v): v is string => !!v)
    .join(' ');
  const invalid = fromField?.['aria-invalid'] === true || own.invalid === true;
  return {
    ...(fromField?.id ? { id: fromField.id } : {}),
    ...(invalid ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
}
