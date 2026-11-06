import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';

interface KbErrorNoticeProps {
  /** The raw backend string, exactly as the catch site captured it. */
  raw: string;
  /** Renders a dismiss affordance when the surface owns one (the drop banner). */
  onDismiss?: () => void;
  /** Positioning/spacing for the call site; the panel treatment is fixed here. */
  className?: string;
  /** Drop the leading icon and tighten the type — for the compact drop banner. */
  compact?: boolean;
  /**
   * `raw` is a string this app authored and already translated (a local
   * precondition, not a backend failure). Registry resolution would replace it
   * with the generic fallback and lose the specific thing it says, so it is
   * rendered as-is and carries no technical-details disclosure.
   */
  localized?: boolean;
}

/**
 * The one error panel for the vector-KB surfaces.
 *
 * Every failure path in this feature used to render `err.message` verbatim: an
 * English `AppError` string from Rust, shown identically in all 14 locales, at
 * the single most stressful moment the feature has. `resolveErrorTranslated`
 * exists for exactly this and none of these call sites reached it.
 *
 * The raw string is not thrown away — an unmatched error resolves to the
 * generic localized fallback, which on its own would be *less* informative than
 * the diagnostic it replaced, so the original text stays one disclosure away.
 */
export function KbErrorNotice({ raw, onDismiss, className = '', compact = false, localized = false }: KbErrorNoticeProps) {
  const { t } = useTranslation();
  const friendly = localized
    ? { message: raw, suggestion: '' }
    : resolveErrorTranslated(t, raw);
  const typo = compact ? 'typo-caption' : 'typo-body';

  return (
    <div
      className={`p-3 rounded-card bg-status-error/10 border border-status-error/20 ${typo} text-status-error flex items-start gap-2 ${className}`}
    >
      {!compact && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
      <div className="flex-1 min-w-0">
        <p>{friendly.message}</p>
        {friendly.suggestion && <p className="text-status-error/70 mt-0.5">{friendly.suggestion}</p>}
        {/* Only worth a disclosure when it says something the friendly copy did not. */}
        {!localized && raw !== friendly.message && (
          <details className="mt-1.5">
            <summary className="typo-caption text-status-error/40 cursor-pointer hover:text-status-error/60 transition-colors">
              {t.vault.forms.technical_details}
            </summary>
            <p className="mt-1 typo-code text-status-error/40 break-all">{raw}</p>
          </details>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.common.dismiss}
          className="text-status-error/60 hover:text-status-error shrink-0"
        >
          &times;
        </button>
      )}
    </div>
  );
}
