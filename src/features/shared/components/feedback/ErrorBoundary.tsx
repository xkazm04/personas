import { Component, type ReactNode } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Copy, Check, Home, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { persistCrash } from '@/lib/utils/crashPersistence';
import { useSystemStore } from "@/stores/systemStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("error-boundary");

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Friendly name shown in the fallback UI */
  name?: string;
  /** Called when the user clicks "Try Again" */
  onReset?: () => void;
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
}: {
  name?: string;
  error: Error | null;
  errorInfo: string | null;
  onReset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const handleGoHome = () => {
    setSidebarSection('home');
    onReset();
  };

  const handleReport = () => {
    const text = [
      `Component: ${name || 'unknown'}`,
      `Error: ${error?.message}`,
      `Stack: ${error?.stack}`,
      `Component Stack: ${errorInfo}`,
    ].join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
                  ? `Something unexpected happened in ${name}`
                  : 'Something unexpected happened'}
              </p>
              <p className="typo-body text-muted-foreground mt-0.5">
                Don't worry -- your data is safe. You can try again or head back to the dashboard.
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
              Try Again
            </button>
            <button
              onClick={handleGoHome}
              className="flex items-center gap-2 px-3 py-2 typo-body rounded-xl border border-primary/15 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              Go to Dashboard
            </button>
          </div>

          {/* Report button */}
          <button
            onClick={handleReport}
            className="flex items-center gap-1.5 typo-body text-muted-foreground/70 hover:text-muted-foreground transition-colors mb-3"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied to clipboard' : 'Copy report for support'}
          </button>

          {/* Details toggle -- hidden by default, labeled for developers */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 typo-caption text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
          >
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            For developers
          </button>

          {showDetails && (
            <div className="mt-2 p-3 rounded-lg bg-background/60 border border-primary/10 overflow-hidden">
              <pre className="typo-code text-muted-foreground/70 whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed">
                {error?.stack || 'No stack trace available'}
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
