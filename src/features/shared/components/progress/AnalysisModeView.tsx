import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AnalysisPhaseInfo } from './transformProgressTypes';
import { TerminalBody, useTerminalScroll } from './TerminalBody';

interface AnalysisModeViewProps {
  lines: string[];
  isRunning: boolean;
  analysisPhase: AnalysisPhaseInfo | null;
}

export function AnalysisModeView({ lines, isRunning, analysisPhase }: AnalysisModeViewProps) {
  const [showTerminal, setShowTerminal] = useState(true);
  const { terminalRef, handleTerminalScroll } = useTerminalScroll(lines);

  return (
    <div className="border border-primary/15 rounded-xl overflow-hidden bg-background shadow-[0_0_15px_rgba(0,0,0,0.2)]" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {isRunning && analysisPhase && (
          <motion.div
            key={analysisPhase.step}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3 px-4 py-2 bg-blue-500/5 border-b border-blue-500/10"
          >
            <span className="typo-code text-blue-400/60 shrink-0">
              Step {analysisPhase.step} of {analysisPhase.total}
            </span>
            <div className="flex-1 h-1 rounded-full bg-secondary/30 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-blue-400/40"
                initial={{ width: 0 }}
                animate={{ width: `${(analysisPhase.step / analysisPhase.total) * 100}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
            <span className="typo-body text-blue-400/80 truncate">{analysisPhase.label}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setShowTerminal(!showTerminal)}
        className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 border-b border-primary/10 cursor-pointer hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {showTerminal ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/90" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/90" />
          )}
          <span className="typo-code text-muted-foreground/90">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                {analysisPhase ? analysisPhase.label : 'Analyzing...'}
              </span>
            ) : (
              'Complete'
            )}
          </span>
        </div>
        <span className="typo-code text-muted-foreground/80">{lines.length} lines</span>
      </button>

      {showTerminal && (
        <div
          ref={terminalRef}
          onScroll={handleTerminalScroll}
          className="max-h-[200px] overflow-y-auto typo-code bg-background"
        >
          <TerminalBody lines={lines} />
        </div>
      )}
    </div>
  );
}
