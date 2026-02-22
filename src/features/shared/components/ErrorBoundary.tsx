import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';

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

    // Log to console for dev tools
    console.error(`[ErrorBoundary:${this.props.name || 'unknown'}] Caught error:`, error);
    console.error('Component stack:', info);

    // Persist to localStorage for crash reporting
    try {
      const crashes = JSON.parse(localStorage.getItem('__personas_frontend_crashes') || '[]');
      crashes.unshift({
        timestamp: new Date().toISOString(),
        component: this.props.name || 'unknown',
        message: error.message,
        stack: error.stack?.slice(0, 2000),
        componentStack: info.slice(0, 1000),
      });
      // Keep only last 20 entries
      localStorage.setItem('__personas_frontend_crashes', JSON.stringify(crashes.slice(0, 20)));
    } catch {
      // localStorage might be full
    }
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

  const handleCopy = () => {
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
        <div className="p-6 rounded-2xl bg-red-500/5 border border-red-500/15">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-400">
                {name ? `${name} crashed` : 'Something went wrong'}
              </p>
              <p className="text-sm text-red-400/60 mt-0.5">
                {error?.message || 'An unexpected error occurred'}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-primary/15 text-muted-foreground/90 hover:text-muted-foreground transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Error'}
            </button>
          </div>

          {/* Details toggle */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors"
          >
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Technical details
          </button>

          {showDetails && (
            <div className="mt-2 p-3 rounded-lg bg-background/60 border border-primary/10 overflow-hidden">
              <pre className="text-sm text-muted-foreground/90 whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed">
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
