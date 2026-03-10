import { AlertTriangle, X, RefreshCw, ChevronLeft } from 'lucide-react';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';

interface ErrorBannerProps {
  message: string;
  /** @default 'banner' */
  variant?: 'inline' | 'banner' | 'panel';
  onDismiss?: () => void;
  onRetry?: () => void;
  onBack?: () => void;
}

export function ErrorBanner({
  message,
  variant = 'banner',
  onDismiss,
  onRetry,
  onBack,
}: ErrorBannerProps) {
  if (variant === 'panel') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <p className="text-sm text-red-400 max-w-md">{message}</p>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/90 bg-secondary/50 hover:bg-secondary/70 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Go back
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const isInline = variant === 'inline';
  const sizeClass = isInline ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2.5 ${sizeClass} ${SEVERITY_STYLES.error.border} ${SEVERITY_STYLES.error.bg} rounded-xl text-sm ${SEVERITY_STYLES.error.text}`}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1 text-red-400/80 hover:text-red-300 text-sm font-medium shrink-0 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="text-red-400/60 hover:text-red-300 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
