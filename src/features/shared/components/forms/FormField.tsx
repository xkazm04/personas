import { useId, useEffect, useState, useRef, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { SuccessCheck } from './SuccessCheck';
import { CharBudget } from './CharBudget';
import type { ValidationState } from './useFieldValidation';

/** Props injected into the render-prop children for accessible input binding. */
export interface FormFieldInputProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * When validation feedback (error text + aria-invalid + shake) becomes visible:
 * - `'change'` — immediately, on every keystroke. Use for fields where instant
 *   feedback is essential (e.g. password strength meters that the user is
 *   actively watching).
 * - `'blur'` — only after the field has been blurred at least once, then live
 *   on subsequent edits. The default — matches NN/g, GOV.UK, and Material
 *   guidance, keeps forms from feeling combative on first keystroke.
 * - `'submit'` — only after `forceValidation` is set true (typically by the
 *   parent form on submit). Use for short forms where mid-typing errors would
 *   be noisier than helpful.
 */
export type ValidateOn = 'change' | 'blur' | 'submit';

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
   * When errors / aria-invalid / shake become visible. Defaults to `'blur'`,
   * which suppresses combative red feedback on every keystroke and reveals it
   * once the user has had a chance to finish typing. See {@link ValidateOn}.
   */
  validateOn?: ValidateOn;
  /**
   * Forces error display regardless of `validateOn` — typically set to `true`
   * by the parent form when the user attempts submit, so all errors surface
   * at once.
   */
  forceValidation?: boolean;
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
  /**
   * Current text length. When provided alongside `maxLength`, a progressive
   * `120/200` character-budget meter renders bottom-right of the field.
   */
  value?: string | number;
  /**
   * Character cap. When provided alongside `value`, enables the budget meter.
   * Pass the same value to the underlying input's `maxLength` attribute.
   */
  maxLength?: number;
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
  validateOn = 'blur',
  forceValidation = false,
  children,
  value,
  maxLength,
}: FormFieldProps) {
  const autoId = useId();
  const fieldId = `ff-${autoId}`;
  const errorId = `${fieldId}-err`;
  const helpId = `${fieldId}-help`;
  const [focused, setFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showSuccessPop, setShowSuccessPop] = useState(false);
  const prevEffectiveErrorRef = useRef<string | undefined>(undefined);

  // Gate the error / aria-invalid / shake on the validateOn policy. After
  // first blur (or on submit) we behave like 'change' — live feedback as the
  // user corrects their input.
  const errorVisible =
    !!error &&
    (validateOn === 'change' || forceValidation || (validateOn === 'blur' && hasInteracted));
  const effectiveError = errorVisible ? error : undefined;

  const showCharBudget =
    typeof maxLength === 'number' && maxLength > 0 && typeof value !== 'undefined';
  const charLength = typeof value === 'string' ? value.length : Number(value ?? 0);

  const describedBy = effectiveError ? errorId : helpText ? helpId : undefined;

  const inputProps: FormFieldInputProps = {
    id: fieldId,
    ...(effectiveError ? { 'aria-invalid': true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };

  // Shake on transitions to a *visible* error.
  useEffect(() => {
    if (!effectiveError || !shakeRef?.current) return;
    const el = shakeRef.current;
    el.classList.remove('animate-shake-error');
    void el.offsetWidth;
    el.classList.add('animate-shake-error');

    const onEnd = () => {
      el.classList.remove('animate-shake-error');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd, { once: true });
  }, [effectiveError, shakeRef]);

  // Detect error → valid transition so we can pop the checkmark in.
  const showCheck = validationState ? validationState === 'valid' : (!effectiveError && valid);
  const showSpinner = validationState === 'validating';

  useEffect(() => {
    if (prevEffectiveErrorRef.current && !effectiveError && showCheck) {
      setShowSuccessPop(true);
    }
    prevEffectiveErrorRef.current = effectiveError;
  }, [effectiveError, showCheck]);

  const handleSuccessAnimEnd = (e: React.AnimationEvent<HTMLSpanElement>) => {
    if (e.animationName === 'success-pop') setShowSuccessPop(false);
  };

  const handleWrapperBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (showCharBudget) setFocused(false);
    // Mark interacted only when focus leaves the FormField entirely, not when
    // moving between inner elements (e.g. an input + adornment button).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!hasInteracted && validateOn === 'blur') setHasInteracted(true);
  };

  const handleWrapperFocus = () => {
    if (showCharBudget) setFocused(true);
  };

  return (
    <div
      ref={shakeRef}
      className={`space-y-1.5 ${className ?? ''}`}
      onFocus={handleWrapperFocus}
      onBlur={handleWrapperBlur}
    >
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
          <span
            className={`ml-1.5 inline-block ${showSuccessPop ? 'animate-success-pop' : ''}`}
            onAnimationEnd={handleSuccessAnimEnd}
          >
            <SuccessCheck visible />
          </span>
        )}
      </label>

      {hint && <p className="typo-body text-foreground">{hint}</p>}

      {typeof children === 'function' ? children(inputProps) : children}

      {(effectiveError || helpText || showCharBudget) && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {effectiveError ? (
              <p
                key="error"
                id={errorId}
                className="animate-fade-slide-in typo-body text-red-400"
                role="alert"
              >
                {effectiveError}
              </p>
            ) : helpText ? (
              <p id={helpId} className="typo-body text-foreground">
                {helpText}
              </p>
            ) : null}
          </div>
          {showCharBudget && (
            <CharBudget value={charLength} max={maxLength!} focused={focused} />
          )}
        </div>
      )}
    </div>
  );
}
