import { type ReactNode } from 'react';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import { RecoverySpiral } from './illustrations/RecoverySpiral';
import { InlineErrorBanner } from './InlineErrorBanner';

interface InlineErrorRecoveryProps {
  /**
   * Raw error string. When `null`/`undefined` the component renders nothing,
   * letting callers swap it in/out without conditional wrappers.
   */
  error: string | null | undefined;
  /** Caller-supplied retry handler. */
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Override the default "we caught that for you" headline. */
  recoveredTitle?: string;
  /** Render slot for actions inside the banner (after Retry/Dismiss). */
  actions?: ReactNode;
  className?: string;
  /** Compact padding for inline contexts. */
  compact?: boolean;
}

export function InlineErrorRecovery({
  error,
  onRetry,
  onDismiss,
  recoveredTitle,
  actions,
  className = '',
  compact = false,
}: InlineErrorRecoveryProps) {
  const { t } = useTranslation();

  if (!error) return null;

  const resolved = resolveErrorTranslated(t, error);

  if (resolved.category !== 'recoverable') {
    return (
      <InlineErrorBanner
        severity="error"
        message={resolved.message}
        onRetry={onRetry}
        onDismiss={onDismiss}
        actions={actions}
        compact={compact}
        className={className}
      />
    );
  }

  const title = recoveredTitle ?? t.error_registry.recovered_title;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${className}`}
    >
      <RecoverySpiral
        width={72}
        height={54}
        className="text-emerald-400 flex-shrink-0"
        ariaLabel={t.error_registry.recovered_illustration_aria}
      />
      <div className="flex-1 min-w-0">
        <p className="typo-heading text-emerald-300">{title}</p>
        <p className="typo-body text-emerald-400/70 mt-0.5">{resolved.message}</p>
        {resolved.suggestion && (
          <p className="typo-caption text-emerald-400/60 mt-1">{resolved.suggestion}</p>
        )}
      </div>
      {actions}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 typo-heading rounded-xl border bg-emerald-500/15 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer shrink-0"
        >
          {t.common.retry}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.common.dismiss}
          className="text-emerald-400/60 hover:text-emerald-300 transition-colors cursor-pointer shrink-0"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      )}
    </div>
  );
}
