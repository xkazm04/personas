import { Component, type ReactNode } from 'react';
import { RefreshCw, RotateCcw, ChevronDown, ChevronRight, Copy, Check, Home, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { persistCrash } from '@/lib/utils/crashPersistence';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';
import { isChunkLoadError } from '@/lib/lazyRetry';

const logger = createLogger("error-boundary");

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Friendly name shown in the fallback UI */
  name?: string;
  /** Called when the user clicks "Try Again" */
  onReset?: () => void;
  /** Called when the user clicks "Go to dashboard". Lets the host navigate home
   *  without the boundary (a shared primitive) importing an app store. */
  onGoHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

/**
 * React Error Boundary that catches render crashes and shows a recovery UI
 * instead of killing the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const info = errorInfo.componentStack || '';
    this.setState({ errorInfo: info });

    logger.error('Caught render error', { name: this.props.name ?? 'unknown', error: error.message, componentStack: info });

    // Persist to localStorage for crash reporting
    persistCrash(this.props.name || 'unknown', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          name={this.props.name}
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
          onGoHome={this.props.onGoHome}
        />
      );
    }

    return this.props.children;
  }
}

/** The fallback UI shown when an error is caught */
function ErrorFallback({
  name,
  error,
  errorInfo,
  onReset,
  onGoHome,
}: {
  name?: string;
  error: Error | null;
  errorInfo: string | null;
  onReset: () => void;
  onGoHome?: () => void;
}) {
  const { t, tx } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  // Failed chunk fetch (dev-server restart, post-deploy stale chunk) — the
  // lazyRetry wrappers make "Try Again" re-import, but if the server is still
  // unreachable the only reliable recovery is a full reload, so surface it.
  const chunkError = isChunkLoadError(error);

  const handleGoHome = () => {
    try {
      // The host wires `onGoHome` (e.g. navigate to the dashboard) — the boundary
      // itself stays store-free so it can live in the shared catalog. If no host
      // handler is provided we still clear the error via onReset().
      onGoHome?.();
      onReset();
    } catch {
      // Store action itself failed (truly broken state) — fall back to hard
      // navigation as a last resort.
      window.location.hash = '#/';
      window.location.reload();
    }
  };

  const handleReport = () => {
    const text = [
      `Component: ${name || 'unknown'}`,
      `Error: ${error?.message}`,
      `Stack: ${error?.stack}`,
      `Component Stack: ${errorInfo}`,
    ].join('\n\n');

    copy(text);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-md w-full">
        <div className="p-6 rounded-xl bg-amber-500/5 border border-amber-500/15">
          {/* Header */}
          <div className="flex items-start gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <LifeBuoy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="typo-heading text-foreground">
                {name
                  ? tx(t.common.error_boundary_title_named, { name })
                  : t.common.error_boundary_title}
              </p>
              <p className="typo-body text-foreground mt-0.5">
                {chunkError
                  ? t.common.error_boundary_chunk_subtitle
                  : t.common.error_boundary_subtitle}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4 mb-3">
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t.common.try_again}
            </button>
            {chunkError && (
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-3 py-2 typo-body rounded-xl border border-primary/15 text-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t.common.reload_app}
              </button>
            )}
            <button
              onClick={handleGoHome}
              className="flex items-center gap-2 px-3 py-2 typo-body rounded-xl border border-primary/15 text-foreground hover:text-foreground transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              {t.common.go_to_dashboard}
            </button>
          </div>

          {/* Report button */}
          <button
            onClick={handleReport}
            className="flex items-center gap-1.5 typo-body text-foreground hover:text-foreground transition-colors mb-3"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? t.common.copied_to_clipboard : t.common.copy_report}
          </button>

          {/* Details toggle -- hidden by default, labeled for developers */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t.common.for_developers}
          </button>

          {showDetails && (
            <div className="mt-2 p-3 rounded-lg bg-background/60 border border-primary/10 overflow-hidden">
              <pre className="typo-code text-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed">
                {error?.stack || t.common.no_stack_trace}
                {errorInfo && (
                  <>
                    {'\n\n--- Component Stack ---\n'}
                    {errorInfo}
                  </>
                )}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
