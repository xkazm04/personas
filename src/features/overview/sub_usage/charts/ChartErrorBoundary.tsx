import { Component, type ReactNode } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';

interface ChartErrorBoundaryProps {
  children: ReactNode;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
}

/**
 * Lightweight error boundary for Recharts components.
 * Catches render errors from malformed chart data (NaN, Infinity, unexpected structures)
 * and displays a compact fallback instead of crashing the entire panel.
 */
export class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, ChartErrorBoundaryState> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): Partial<ChartErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ChartErrorBoundary] Chart render error:', error);
    console.error('Component stack:', errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full gap-2 py-6">
          <BarChart3 className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Chart unavailable</span>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-primary/15 text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
