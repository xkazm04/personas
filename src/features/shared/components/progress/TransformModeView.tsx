import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformPhaseInfo } from './transformProgressTypes';
import { TerminalBody, useTerminalScroll } from './TerminalBody';
import { TransformStatusPanels } from './TransformStatusPanels';

interface TransformModeViewProps {
  lines: string[];
  phase: CliRunPhase;
  runId?: string | null;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  errorMessage?: string | null;
  transformPhase: TransformPhaseInfo | null;
}

export function TransformModeView({
  lines,
  phase,
  runId,
  isRestoring,
  onRetry,
  onCancel,
  errorMessage,
  transformPhase,
}: TransformModeViewProps) {
  const [showTerminal, setShowTerminal] = useState(true);
  const { terminalRef, handleTerminalScroll } = useTerminalScroll(lines);

  useEffect(() => {
    if (phase === 'failed') setShowTerminal(true);
  }, [phase]);

  const progressPercent = transformPhase ? (transformPhase.step / transformPhase.total) * 100 : 0;

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
        <div className="p-4">
          <TransformStatusPanels
            phase={phase}
            transformPhase={transformPhase}
            progressPercent={progressPercent}
            isRestoring={isRestoring}
            onRetry={onRetry}
            onCancel={onCancel}
            errorMessage={errorMessage}
          />
        </div>

        {lines.length > 0 && (
          <>
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 border-t border-primary/10 cursor-pointer hover:bg-secondary/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {showTerminal ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />
                )}
                <span className="typo-code text-muted-foreground/80">
                  {showTerminal ? 'Hide' : 'Show'} CLI output
                </span>
              </div>
              <div className="flex items-center gap-2">
                {runId && (
                  <span className="typo-code text-muted-foreground/80">{runId.slice(0, 8)}</span>
                )}
                <span className="typo-code text-muted-foreground/80">{lines.length} lines</span>
              </div>
            </button>

            {showTerminal && (
                <div
                  className="animate-fade-slide-in overflow-hidden"
                >
                  <div
                    ref={terminalRef}
                    onScroll={handleTerminalScroll}
                    className="max-h-[200px] overflow-y-auto typo-code bg-background"
                  >
                    <TerminalBody lines={lines} />
                  </div>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}
