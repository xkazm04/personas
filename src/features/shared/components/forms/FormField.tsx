import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/** Props injected into the render-prop children for accessible input binding. */
export interface FormFieldInputProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export interface FormFieldProps {
  /** Visible label text. */
  label: string;
  /** Show a red asterisk after the label. */
  required?: boolean;
  /** Validation error — displayed below the input and wired to aria-describedby. */
  error?: string;
  /** Secondary guidance shown below the input when there is no error. */
  helpText?: string;
  /** Short hint displayed between the label and the input. */
  hint?: string;
  /** Extra classes on the outer wrapper div. */
  className?: string;
  /**
   * Either a plain ReactNode **or** a render-prop that receives accessible
   * input props (`id`, `aria-invalid`, `aria-describedby`).
   *
   * Prefer the render-prop form so that the input is automatically wired to
   * the label and error text:
   *
   * ```tsx
   * <FormField label="Name" error={err}>
   *   {(inputProps) => <input {...inputProps} value={v} onChange={…} className={INPUT_FIELD} />}
   * </FormField>
   * ```
   */
  children: ReactNode | ((inputProps: FormFieldInputProps) => ReactNode);
}

/**
 * Shared wrapper that unifies the label + input + error/help-text pattern
 * used across all forms.  Standardises spacing, label styling, required
 * indicator, and wires `aria-invalid` / `aria-describedby` for a11y.
 */
export function FormField({
  label,
  required,
  error,
  helpText,
  hint,
  className,
  children,
}: FormFieldProps) {
  const autoId = useId();
  const fieldId = `ff-${autoId}`;
  const errorId = `${fieldId}-err`;
  const helpId = `${fieldId}-help`;

  const describedBy = error ? errorId : helpText ? helpId : undefined;

  const inputProps: FormFieldInputProps = {
    id: fieldId,
    ...(error ? { 'aria-invalid': true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };

  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground/80">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>

      {hint && <p className="text-sm text-muted-foreground/80">{hint}</p>}

      {typeof children === 'function' ? children(inputProps) : children}

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={errorId}
            className="text-sm text-red-400"
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            {error}
          </motion.p>
        ) : helpText ? (
          <p id={helpId} className="text-sm text-muted-foreground/60">
            {helpText}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
