import { motion } from 'framer-motion';
import { ArrowRight, Download, Sparkles } from 'lucide-react';

export function FooterActions({
  loading,
  ipcError,
  hasNodeIssue,
  hasClaudeIssue,
  anyInstalling,
  hasIssues,
  personas,
  onboardingCompleted,
  onboardingActive,
  install,
  startOnboarding,
  onNext,
}: {
  loading: boolean;
  ipcError: boolean;
  hasNodeIssue: boolean;
  hasClaudeIssue: boolean;
  anyInstalling: boolean;
  hasIssues: boolean;
  personas: unknown[];
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  install: (target: 'node' | 'claude_cli' | 'all') => void;
  startOnboarding: () => void;
  onNext?: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        {!loading && !ipcError && hasNodeIssue && hasClaudeIssue && (
          <button
            onClick={() => install('all')}
            disabled={anyInstalling}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            Install All Dependencies
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {!loading && !hasIssues && !ipcError && personas.length === 0 && !onboardingCompleted && !onboardingActive && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/8 to-indigo-500/5 p-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground/90">Ready to create your first agent?</h3>
              <p className="text-sm text-muted-foreground/70">All checks passed. Let us guide you through creating and running your first agent.</p>
            </div>
            <button
              onClick={startOnboarding}
              className="flex-shrink-0 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Get Started
            </button>
          </div>
        </motion.div>
      )}
    </>
  );
}
