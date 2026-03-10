/**
 * Terminal output and result summary for DesignReviewRunner.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface TestRunResult {
  testRunId: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
}

// ── Terminal Output ──────────────────────────────────────────────────

interface TerminalOutputProps {
  lines: string[];
  isRunning: boolean;
  hasStarted: boolean;
  animateFromRef: React.MutableRefObject<number>;
}

export function TerminalOutput({ lines, isRunning, hasStarted, animateFromRef }: TerminalOutputProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    if (!terminalRef.current) return;
    const el = terminalRef.current;
    const observer = new ResizeObserver(() => {
      if (shouldAutoScroll.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  };

  return (
    <div className="flex-1 min-h-0">
      <div
        ref={terminalRef}
        onScroll={handleScroll}
        className={`${hasStarted ? 'h-[400px]' : 'h-[100px]'} overflow-y-auto font-mono text-sm bg-background transition-all`}
      >
        {!hasStarted ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/80 text-sm">
            Output will appear here when the review starts
          </div>
        ) : (
          <div className="p-3">
            {lines.map((line, index) => {
              const shouldAnimate = index >= animateFromRef.current;
              const Wrapper = shouldAnimate ? motion.div : 'div';
              const animProps = shouldAnimate ? {
                initial: { opacity: 0, x: -4 },
                animate: { opacity: 1, x: 0 },
                transition: { delay: (index - animateFromRef.current) * 0.02, duration: 0.15 },
              } : {};

              return (
                <Wrapper key={index} className="flex gap-2 py-px" {...animProps}>
                  <span className="text-muted-foreground/20 select-none flex-shrink-0 w-8 text-right">
                    {(index + 1).toString().padStart(3, ' ')}
                  </span>
                  <span className={`break-all ${
                    line.includes('PASSED') ? 'text-emerald-400/80' :
                    line.includes('FAILED') ? 'text-red-400/80' :
                    line.includes('ERROR') ? 'text-amber-400/80' :
                    line.includes('Generating:') ? 'text-violet-400/60' :
                    line.includes('Cancelled') ? 'text-orange-400/80' :
                    line.includes('[TestRunner]') ? 'text-violet-400/80' :
                    'text-blue-400/80'
                  }`}>{line}</span>
                </Wrapper>
              );
            })}
            {isRunning && (
              <div className="flex items-center gap-2 py-1 text-blue-400/60">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span>Running...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Result Summary ──────────────────────────────────────────────────

export function ResultSummary({ result }: { result: TestRunResult }) {
  return (
    <div className="px-4 py-3 border-t border-primary/10 bg-primary/5">
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          {result.passed} passed
        </span>
        <span className="flex items-center gap-1.5 text-red-400">
          <XCircle className="w-4 h-4" />
          {result.failed} failed
        </span>
        <span className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          {result.errored} errors
        </span>
        <span className="ml-auto text-muted-foreground/90 text-sm">
          {result.totalTests} total tests
        </span>
      </div>
    </div>
  );
}
