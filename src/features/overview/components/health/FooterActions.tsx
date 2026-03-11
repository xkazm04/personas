import { motion } from 'framer-motion';
import { ArrowRight, Download, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

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
          <Button
            variant="accent"
            accentColor="violet"
            size="md"
            onClick={() => install('all')}
            disabled={anyInstalling}
            icon={<Download className="w-4 h-4" />}
            className="flex-1"
          >
            Install All Dependencies
          </Button>
        )}
        {onNext && (
          <Button
            variant="accent"
            accentColor="violet"
            size="md"
            onClick={onNext}
            disabled={loading}
            iconRight={<ArrowRight className="w-4 h-4" />}
            className="flex-1"
          >
            Continue
          </Button>
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
            <Button
              variant="accent"
              accentColor="violet"
              size="md"
              onClick={startOnboarding}
              icon={<Sparkles className="w-4 h-4" />}
              className="flex-shrink-0"
            >
              Get Started
            </Button>
          </div>
        </motion.div>
      )}
    </>
  );
}
