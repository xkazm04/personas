import { useEffect, useRef } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { DesignPhaseAppliedDetails } from './DesignPhaseAppliedDetails';

interface DesignPhaseAppliedProps {
  result: DesignAnalysisResult | null;
  warnings?: string[];
  onReset: () => void;
}

export function DesignPhaseApplied({ result, warnings = [], onReset }: DesignPhaseAppliedProps) {
  const hasWarnings = warnings.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <motion.div
      key="applied"
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="flex flex-col items-center py-8 gap-6"
      ref={containerRef}
      tabIndex={-1}
    >
      {/* Animated success checkmark */}
      <div className="relative">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
          className={`w-14 h-14 rounded-full flex items-center justify-center ${
            hasWarnings
              ? 'bg-amber-500/15 ring-2 ring-amber-500/30'
              : 'bg-emerald-500/15 ring-2 ring-emerald-500/30'
          }`}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.3 }}
          >
            {hasWarnings
              ? <AlertTriangle className="w-6 h-6 text-amber-400" />
              : <Check className="w-6 h-6 text-emerald-400" strokeWidth={3} />
            }
          </motion.div>
        </motion.div>
        {/* Expanding pulse ring on success */}
        {!hasWarnings && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full ring-2 ring-emerald-500/40"
          />
        )}
      </div>

      {/* Title + summary */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center"
      >
        <h3 className={`text-base font-semibold ${hasWarnings ? 'text-amber-400' : 'text-emerald-400'}`}>
          {hasWarnings ? `Applied with ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : 'Agent configured!'}
        </h3>
        {result?.summary && (
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs mx-auto line-clamp-2">
            {result.summary}
          </p>
        )}
      </motion.div>

      {/* Warnings */}
      {hasWarnings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="w-full max-w-sm px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
        >
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-sm text-amber-400/90 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Stats + Next steps (extracted component) */}
      <DesignPhaseAppliedDetails result={result} onReset={onReset} />

      {/* Subtle close link */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        onClick={onReset}
        className="mt-1 text-sm text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
      >
        Close
      </motion.button>
    </motion.div>
  );
}
