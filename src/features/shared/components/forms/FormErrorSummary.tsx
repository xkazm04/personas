import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormErrors } from './FormErrorContext';

export interface FormErrorSummaryProps {
  /** Extra classes on the banner container (e.g. bottom margin). */
  className?: string;
}

/**
 * Accessible error-summary banner for long forms. Collects every visible
 * {@link FormField} error registered with the surrounding {@link FormErrorProvider}
 * and lists each as a jump-to-field button: clicking scrolls the offending input
 * into view (`scrollIntoView({ block: 'center' })`) and focuses it.
 *
 * Renders nothing when there are no errors. As a `role="alert"` region it is
 * announced by screen readers the moment errors appear (WCAG 3.3.1 error
 * identification), and the per-error buttons give keyboard users a one-tab path
 * to each field instead of hunting down a long form.
 */
export function FormErrorSummary({ className }: FormErrorSummaryProps) {
  const { t, tx } = useTranslation();
  const errors = useFormErrors();

  if (errors.length === 0) return null;

  const jumpTo = (fieldId: string) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // preventScroll: the smooth scroll above owns positioning; focus() must not
    // fight it with an instant jump.
    if (typeof (el as HTMLElement).focus === 'function') {
      (el as HTMLElement).focus({ preventScroll: true });
    }
  };

  const titleKey =
    errors.length === 1
      ? t.common.form_error_summary_title_one
      : t.common.form_error_summary_title_other;

  return (
    <div
      role="alert"
      className={`animate-fade-slide-in rounded-card border border-red-500/30 bg-red-500/5 p-3 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 text-red-400" />
        <p className="typo-heading text-red-400">{tx(titleKey, { count: errors.length })}</p>
      </div>
      <ul className="space-y-1">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <button
              type="button"
              onClick={() => jumpTo(e.fieldId)}
              className="focus-ring rounded text-left typo-body text-red-400/90 transition-colors hover:text-red-300 hover:underline"
            >
              <span className="font-medium">{e.label}:</span> {e.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
