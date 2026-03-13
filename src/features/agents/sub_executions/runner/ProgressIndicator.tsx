import { motion } from 'framer-motion';
import { RunningIcon } from '../components/ExecutionLifecycleIcons';
import { formatElapsed } from '@/lib/utils/formatters';
import { MiniPlayerPinButton } from './MiniPlayerPinButton';

interface ProgressIndicatorProps {
  elapsedMs: number;
  typicalDurationMs: number | null;
}

export function ProgressIndicator({ elapsedMs, typicalDurationMs }: ProgressIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-xl"
    >
      <RunningIcon size={14} className="flex-shrink-0" />
      {/* Mini-player pin toggle */}
      <MiniPlayerPinButton />
      <div className="flex-1 min-w-0">
        {typicalDurationMs ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground/80">
                {formatElapsed(elapsedMs)} elapsed
              </span>
              <span className="text-muted-foreground/80">
                {elapsedMs < typicalDurationMs
                  ? `Typically completes in ~${formatElapsed(typicalDurationMs)}`
                  : 'Taking longer than usual...'}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-primary/40"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (elapsedMs / typicalDurationMs) * 100)}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground/90">
            {formatElapsed(elapsedMs)} elapsed
          </span>
        )}
      </div>
    </motion.div>
  );
}
