import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type DesignLineStyle = 'error' | 'system' | 'success' | 'default';

const DESIGN_LINE_STYLES: Record<DesignLineStyle, { text: string; dot: string }> = {
  error:   { text: 'text-red-400/80',     dot: 'bg-red-400' },
  system:  { text: 'text-amber-400/70',   dot: 'bg-amber-400' },
  success: { text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  default: { text: 'text-blue-400/80',    dot: 'bg-blue-400/40' },
};

function classifyDesignLine(line: string): DesignLineStyle {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('[warn]')) return 'error';
  if (lower.includes('[system]') || lower.includes('starting') || lower.includes('initializing')) return 'system';
  if (lower.includes('complete') || lower.includes('success') || lower.includes('finished') || lower.includes('done') || lower.includes('✓')) return 'success';
  return 'default';
}

/* ── Phase-aware progress detection ── */

const ANALYSIS_PHASES = [
  { keywords: ['[system]', 'starting', 'initializing', 'design analysis started'], label: 'Initializing analysis' },
  { keywords: ['analyzing prompt', 'prompt structure', 'reading prompt', 'parsing'], label: 'Analyzing prompt structure' },
  { keywords: ['identity', 'role', 'persona', 'instructions'], label: 'Evaluating agent identity' },
  { keywords: ['tool', 'function', 'generating tool', 'suggest'], label: 'Recommending tools and triggers' },
  { keywords: ['trigger', 'event', 'schedule', 'channel', 'notification', 'connector'], label: 'Configuring integrations' },
  { keywords: ['feasibility', 'testing', 'validat', 'check'], label: 'Testing feasibility' },
  { keywords: ['summary', 'highlight', 'finaliz', 'complete', 'finished', 'done', '✓'], label: 'Finalizing design' },
] as const;

function detectPhase(lines: string[]): { step: number; total: number; label: string } | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  // Scan all lines to find the furthest-matched phase
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (let i = ANALYSIS_PHASES.length - 1; i > lastMatchedIndex; i--) {
      const p = ANALYSIS_PHASES[i];
      if (p && p.keywords.some((kw) => lower.includes(kw))) {
        lastMatchedIndex = i;
        break;
      }
    }
  }

  if (lastMatchedIndex === -1) return null;
  const matched = ANALYSIS_PHASES[lastMatchedIndex];
  if (!matched) return null;
  return { step: lastMatchedIndex + 1, total: ANALYSIS_PHASES.length, label: matched.label };
}

interface DesignTerminalProps {
  lines: string[];
  isRunning: boolean;
}

export function DesignTerminal({ lines, isRunning }: DesignTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentPhase = useMemo(() => (isRunning ? detectPhase(lines) : null), [lines, isRunning]);

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      shouldAutoScroll.current = isAtBottom;
    }
  };

  return (
    <div className="border border-primary/15 rounded-2xl overflow-hidden bg-background shadow-[0_0_15px_rgba(0,0,0,0.2)]">
      {/* Phase-aware progress hint */}
      <AnimatePresence mode="wait">
        {isRunning && currentPhase && (
          <motion.div
            key={currentPhase.step}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3 px-4 py-2 bg-blue-500/5 border-b border-blue-500/10"
          >
            <span className="text-[10px] font-mono text-blue-400/60 shrink-0">
              Step {currentPhase.step} of {currentPhase.total}
            </span>
            <div className="flex-1 h-1 rounded-full bg-secondary/30 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-blue-400/40"
                initial={{ width: 0 }}
                animate={{ width: `${(currentPhase.step / currentPhase.total) * 100}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
            <span className="text-[11px] text-blue-400/80 truncate">
              {currentPhase.label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terminal Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 border-b border-primary/10 cursor-pointer hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {isCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
          )}
          <span className="text-xs text-muted-foreground/50 font-mono">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                {currentPhase ? currentPhase.label : 'Analyzing...'}
              </span>
            ) : (
              'Complete'
            )}
          </span>
        </div>
        <span className="text-xs text-muted-foreground/30 font-mono">
          {lines.length} lines
        </span>
      </button>

      {/* Terminal Content */}
      {!isCollapsed && (
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="max-h-[200px] overflow-y-auto font-mono text-xs bg-background"
        >
          {lines.length === 0 ? (
            <div className="p-4 text-muted-foreground/30 text-center text-xs">
              No output yet...
            </div>
          ) : (
            <div className="p-3">
              {lines.map((line, index) => {
                const style = classifyDesignLine(line);
                const colors = DESIGN_LINE_STYLES[style];
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.08 }}
                    className="flex items-start gap-2 py-px"
                  >
                    <span className="text-muted-foreground/20 select-none flex-shrink-0 w-8 text-right">
                      {(index + 1).toString().padStart(3, ' ')}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${colors.dot}`} />
                    <span className={`${colors.text} break-all`}>{line}</span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
