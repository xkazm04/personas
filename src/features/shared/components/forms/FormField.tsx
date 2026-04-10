import { useId, useEffect, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { SuccessCheck } from './SuccessCheck';
import type { ValidationState } from './useFieldValidation';

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
   * When true and there is no error, a small animated checkmark appears next
   * to the label to give positive reinforcement.
   */
  valid?: boolean;
  /**
   * Drives inline validation feedback: a spinner while validating, a green
   * checkmark when valid, and the existing red error text on error.
   * When provided, this takes precedence over the `valid` prop.
   */
  validationState?: ValidationState;
  /**
   * Ref returned by `useShakeError()`.  When an error prop is set and this
   * ref is provided, the wrapper will shake to draw attention to the error.
   */
  shakeRef?: RefObject<HTMLDivElement | null>;
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
  valid,
  validationState,
  shakeRef,
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

  // Trigger shake when error transitions from falsy to truthy
  useEffect(() => {
    if (!error || !shakeRef?.current) return;
    const el = shakeRef.current;
    el.classList.remove('animate-shake-error');
    void el.offsetWidth;
    el.classList.add('animate-shake-error');

    const onEnd = () => {
      el.classList.remove('animate-shake-error');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd, { once: true });
  }, [error, shakeRef]);

  const showCheck = validationState ? validationState === 'valid' : (!error && valid);
  const showSpinner = validationState === 'validating';

  return (
    <div ref={shakeRef} className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={fieldId} className="typo-heading text-foreground">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
        {showSpinner && (
          <Loader2
            aria-hidden="true"
            className="ml-1.5 inline-block w-3.5 h-3.5 animate-spin text-foreground align-text-bottom"
          />
        )}
        {showCheck && (
          <span className="ml-1.5">
            <SuccessCheck visible />
          </span>
        )}
      </label>

      {hint && <p className="typo-body text-foreground">{hint}</p>}

      {typeof children === 'function' ? children(inputProps) : children}

      {error ? (
          <p
            key="error"
            id={errorId}
            className="animate-fade-slide-in typo-body text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : helpText ? (
          <p id={helpId} className="typo-body text-foreground">
            {helpText}
          </p>
        ) : null}
    </div>
  );
}
