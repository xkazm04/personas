import { Clock, ArrowLeftRight, X, Shield, Rocket, Play } from 'lucide-react';
import { motion } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface ExecutionListToolbarProps {
  executionCount: number;
  showRaw: boolean;
  onToggleRaw: () => void;
  compareMode: boolean;
  onToggleCompare: () => void;
  compareLeft: string | null;
  compareRight: string | null;
  canCompare: boolean;
  onShowComparison: () => void;
}

export function ExecutionListToolbar({
  executionCount,
  showRaw,
  onToggleRaw,
  compareMode,
  onToggleCompare,
  compareLeft,
  compareRight,
  canCompare,
  onShowComparison,
}: ExecutionListToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          <Clock className="w-3.5 h-3.5" />
          History
        </h4>
        {executionCount > 0 && (
          <Tooltip content={showRaw ? 'Sensitive values are visible' : 'Sensitive values are masked'}>
            <button
              data-testid="exec-toggle-raw"
              onClick={onToggleRaw}
              className={`ml-auto flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
                showRaw
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
              }`}
            >
              <Shield className="w-3 h-3" />
              {showRaw ? 'Raw' : 'Masked'}
            </button>
          </Tooltip>
        )}
        {executionCount >= 2 && (
          <button
            data-testid="exec-toggle-compare"
            onClick={onToggleCompare}
            className={`flex items-center gap-1 px-2 py-1 typo-body rounded-lg transition-colors ${
              compareMode
                ? 'bg-primary/15 text-primary/80 border border-primary/20'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'
            }`}
          >
            {compareMode ? <X className="w-3 h-3" /> : <ArrowLeftRight className="w-3 h-3" />}
            {compareMode ? 'Cancel' : 'Compare'}
          </button>
        )}
      </div>

      {/* Compare mode toolbar */}
      {compareMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl typo-body">
          <ArrowLeftRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          <span className="text-muted-foreground/70">
            {!compareLeft
              ? 'Select the first execution to compare'
              : !compareRight
                ? 'Now select the second execution'
                : 'Ready to compare'}
          </span>
          {compareLeft && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="typo-code text-indigo-400">#{compareLeft.slice(0, 8)}</span>
              {compareRight && (
                <>
                  <span className="text-muted-foreground/40">vs</span>
                  <span className="typo-code text-pink-400">#{compareRight.slice(0, 8)}</span>
                </>
              )}
            </span>
          )}
          {canCompare && (
            <button
              data-testid="exec-show-comparison"
              onClick={onShowComparison}
              className="ml-2 px-2.5 py-1 typo-heading rounded-xl bg-primary/15 text-primary/80 border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              Compare
            </button>
          )}
        </div>
      )}
    </>
  );
}

interface ExecutionListEmptyStateProps {
  onTryIt: () => void;
}

export function ExecutionListEmptyState({ onTryIt }: ExecutionListEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center text-center py-12 px-6 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mb-4">
        <Rocket className="w-5.5 h-5.5 text-primary/40" />
      </div>
      <p className="typo-heading text-foreground/80">
        Your agent is ready to go
      </p>
      <p className="typo-body text-muted-foreground/80 mt-1 max-w-[260px]">
        Run it to see results here. Each execution will appear in this timeline.
      </p>
      <button
        data-testid="exec-try-it"
        onClick={onTryIt}
        className="mt-4 flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
      >
        <Play className="w-3.5 h-3.5" />
        Try it now
      </button>
    </motion.div>
  );
}
