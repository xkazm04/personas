import { AlertTriangle, RefreshCw, ChevronLeft } from 'lucide-react';
import { InlineErrorBanner } from './InlineErrorBanner';

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
        <p className="typo-body text-red-400 max-w-md">{message}</p>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 typo-body text-muted-foreground/80 hover:text-foreground/90 bg-secondary/50 hover:bg-secondary/70 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Go back
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 typo-heading text-white bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <InlineErrorBanner
      severity="error"
      message={message}
      onDismiss={onDismiss}
      onRetry={onRetry}
      compact={variant === 'inline'}
    />
  );
}
