import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Form-level error registry that lets a {@link FormErrorSummary} banner collect
 * the validation errors surfaced by every {@link FormField} inside it, without
 * the form owner having to thread error state manually.
 *
 * Two contexts on purpose:
 * - {@link FormErrorRegistryContext} carries stable register/unregister
 *   callbacks consumed by each FormField. Its value never changes identity, so
 *   adding/removing errors does NOT re-render every field.
 * - {@link FormErrorsContext} carries the ordered error list consumed only by
 *   the summary banner, so only the banner re-renders when errors change.
 */

/** One field's error as displayed in the summary banner. */
export interface FormFieldError {
  /** DOM id of the offending input — used to scrollIntoView + focus on jump. */
  fieldId: string;
  /** Human label of the field (already i18n'd by the FormField caller). */
  label: string;
  /** The active error message (already i18n'd). */
  message: string;
}

interface FormErrorRegistry {
  register: (fieldId: string, label: string, message: string) => void;
  unregister: (fieldId: string) => void;
}

const FormErrorRegistryContext = createContext<FormErrorRegistry | null>(null);
const FormErrorsContext = createContext<FormFieldError[]>([]);

/**
 * Wrap a form's fields in this provider and drop a {@link FormErrorSummary} near
 * the top. FormFields inside automatically register their visible errors.
 *
 * ```tsx
 * <FormErrorProvider>
 *   <FormErrorSummary />
 *   <FormField label={t.x.name} error={errors.name} forceValidation={submitted}>…</FormField>
 *   …
 * </FormErrorProvider>
 * ```
 */
export function FormErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<FormFieldError[]>([]);

  const register = useCallback((fieldId: string, label: string, message: string) => {
    setErrors((prev) => {
      const idx = prev.findIndex((e) => e.fieldId === fieldId);
      const existing = idx === -1 ? undefined : prev[idx];
      if (!existing) return [...prev, { fieldId, label, message }];
      // Idempotent: skip the state update if nothing changed, so a field that
      // keeps the same error across re-renders doesn't churn the banner.
      if (existing.label === label && existing.message === message) return prev;
      const next = prev.slice();
      next[idx] = { fieldId, label, message };
      return next;
    });
  }, []);

  const unregister = useCallback((fieldId: string) => {
    setErrors((prev) =>
      prev.some((e) => e.fieldId === fieldId) ? prev.filter((e) => e.fieldId !== fieldId) : prev,
    );
  }, []);

  const registry = useMemo<FormErrorRegistry>(() => ({ register, unregister }), [register, unregister]);

  return (
    <FormErrorRegistryContext.Provider value={registry}>
      <FormErrorsContext.Provider value={errors}>{children}</FormErrorsContext.Provider>
    </FormErrorRegistryContext.Provider>
  );
}

/**
 * Registry handle for a FormField. Returns `null` when there is no
 * {@link FormErrorProvider} ancestor, so FormField stays a no-op outside a
 * summary-aware form (the common case).
 */
export function useFormErrorRegistry(): FormErrorRegistry | null {
  return useContext(FormErrorRegistryContext);
}

/** Ordered list of currently-registered field errors. Consumed by the summary. */
export function useFormErrors(): FormFieldError[] {
  return useContext(FormErrorsContext);
}
