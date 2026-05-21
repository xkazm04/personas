import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { INPUT_FIELD, INPUT_FIELD_ERROR } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

/* PasswordToggleField — secret-input primitive with show/hide affordance.
 *
 * Wraps a controlled `<input>` and exposes an Eye / EyeOff icon button on the
 * right edge. Keeps `pr-10` padding so user text never collides with the icon.
 *
 * Auto-revert: once revealed, the field flips back to type="password" after 8s
 * of no focus inside the wrapper. The timer resets while the input is focused
 * (so a user actively reading their key is never re-masked mid-glance) and
 * starts the moment focus leaves. This caps shoulder-surf exposure without
 * fighting the user's intent.
 *
 * Use this anywhere a bare <input type="password"> exists today (API keys,
 * passphrases, BYOM provider credentials, etc.).
 */

export interface PasswordToggleFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Override the standard input className (defaults to INPUT_FIELD). */
  inputClassName?: string;
  /** Render the error-bordered variant. */
  hasError?: boolean;
  /** Override the auto-mask timeout in ms. Set to 0 to disable. Defaults to 8000. */
  autoMaskAfterMs?: number;
}

const DEFAULT_AUTOMASK_MS = 8000;

export const PasswordToggleField = forwardRef<HTMLInputElement, PasswordToggleFieldProps>(
  function PasswordToggleField(
    {
      inputClassName,
      hasError,
      autoMaskAfterMs = DEFAULT_AUTOMASK_MS,
      className = '',
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const focusedRef = useRef(false);
    const maskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const baseClass = inputClassName ?? (hasError ? INPUT_FIELD_ERROR : INPUT_FIELD);

    const clearMaskTimer = () => {
      if (maskTimerRef.current) {
        clearTimeout(maskTimerRef.current);
        maskTimerRef.current = null;
      }
    };

    const scheduleMask = () => {
      if (autoMaskAfterMs <= 0) return;
      clearMaskTimer();
      maskTimerRef.current = setTimeout(() => {
        if (!focusedRef.current) setRevealed(false);
      }, autoMaskAfterMs);
    };

    useEffect(() => clearMaskTimer, []);

    // Re-arm the timer whenever the field becomes revealed (initial reveal +
    // any subsequent toggle while unfocused).
    useEffect(() => {
      if (!revealed) return;
      if (!focusedRef.current) scheduleMask();
      // No deps on autoMaskAfterMs — capture-time value is fine for the timer.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealed]);

    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (e) => {
      focusedRef.current = true;
      clearMaskTimer();
      onFocus?.(e);
    };

    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (e) => {
      focusedRef.current = false;
      // If blur leaves the wrapper entirely (not to the toggle button), arm timer.
      const next = e.relatedTarget as Node | null;
      if (!wrapperRef.current?.contains(next) && revealed) {
        scheduleMask();
      }
      onBlur?.(e);
    };

    return (
      <div ref={wrapperRef} className={`relative ${className}`}>
        <input
          {...rest}
          ref={ref}
          type={revealed ? 'text' : 'password'}
          onFocus={handleFocus}
          onBlur={handleBlur}
          // pr-10 reserves space so typed text never slides under the icon.
          className={`${baseClass} pr-10`}
          autoComplete={rest.autoComplete ?? 'current-password'}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? t.common.hide_password : t.common.show_password}
          aria-pressed={revealed}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  },
);
