import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { TransformPhaseInfo } from './transformProgressTypes';

interface TransformStatusPanelsProps {
  phase: CliRunPhase;
  transformPhase: TransformPhaseInfo | null;
  progressPercent: number;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  errorMessage?: string | null;
}

export function TransformStatusPanels({
  phase,
  transformPhase,
  progressPercent,
  isRestoring,
  onRetry,
  onCancel,
  errorMessage,
}: TransformStatusPanelsProps) {
  const PhaseIcon = transformPhase?.Icon ?? Sparkles;

  if (phase === 'running') {
    return (
      <div className="space-y-3">
        {isRestoring && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400/70" />
            <span className="text-sm text-amber-400/80">Resuming previous transformation session...</span>
          </motion.div>
        )}

        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <motion.div
              className="absolute inset-0 w-12 h-12 rounded-xl bg-violet-500/15"
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <PhaseIcon className="w-6 h-6 text-violet-400" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.p
                key={transformPhase?.label ?? 'processing'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="text-sm font-medium text-foreground/80"
              >
                {transformPhase?.label ?? 'Starting transformation...'}
              </motion.p>
            </AnimatePresence>
            <p className="text-sm text-muted-foreground/80 mt-0.5">
              {transformPhase ? `Step ${transformPhase.step} of ${transformPhase.total}` : 'Starting...'}
            </p>

            <div className="mt-3 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400/40"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>

            <p className="text-sm text-muted-foreground/90 mt-2">
              You can continue working -- we'll notify you when the draft is ready.
            </p>
          </div>

          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
              title="Cancel transformation"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'completed') {
    return (
      <div className="flex items-center gap-4">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 300 }}
          className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </motion.div>
        <div>
          <p className="text-sm font-medium text-emerald-400">Draft generated successfully</p>
          <p className="text-sm text-muted-foreground/80 mt-0.5">
            Your persona draft is ready for review and editing.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-400">Transformation failed</p>
          <p className="text-sm text-red-400/60 mt-0.5">
            {errorMessage || 'Check the output below for details.'}
          </p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>
    );
  }

  // idle
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-muted-foreground/80" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground/90">Waiting to start transformation...</p>
        <p className="text-sm text-muted-foreground/80 mt-0.5">
          Click "Generate Persona Draft" to begin.
        </p>
      </div>
    </div>
  );
}
