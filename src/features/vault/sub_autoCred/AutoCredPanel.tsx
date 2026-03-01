import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { useAutoCredSession } from './useAutoCredSession';
import { AutoCredConsent } from './AutoCredConsent';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredReview } from './AutoCredReview';

interface AutoCredPanelProps {
  designResult: CredentialDesignResult;
  onComplete: () => void;
  onCancel: () => void;
}

export function AutoCredPanel({ designResult, onComplete, onCancel }: AutoCredPanelProps) {
  const session = useAutoCredSession();

  // Initialize session when design result arrives
  useEffect(() => {
    session.init(designResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designResult.connector.name]);

  const handleCancel = () => {
    session.reset();
    onCancel();
  };

  return (
    <div className="space-y-4">
      {/* Badge */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Bot className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-400">Auto-Setup via Playwright MCP</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <AutoCredConsent
            key="consent"
            designResult={designResult}
            onConsent={session.startBrowser}
            onCancel={handleCancel}
          />
        )}

        {session.phase === 'browser' && (
          <AutoCredBrowser
            key="browser"
            designResult={designResult}
            logs={session.logs}
            onCancel={session.cancelBrowser}
          />
        )}

        {session.phase === 'review' && (
          <AutoCredReview
            key="review"
            designResult={designResult}
            credentialName={session.credentialName}
            onCredentialNameChange={session.setCredentialName}
            extractedValues={session.extractedValues}
            onValueChange={session.updateValue}
            onHealthcheck={session.runHealthcheck}
            healthResult={session.healthResult}
            onSave={session.save}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
            isSaving={session.isSaving}
          />
        )}

        {session.phase === 'saving' && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-muted-foreground/90">Saving credential...</p>
          </motion.div>
        )}

        {session.phase === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-10 gap-4"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">Credential Saved</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {designResult.connector.label} credential has been securely stored.
              </p>
            </div>
            <button
              onClick={onComplete}
              className="px-5 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-xl text-sm font-medium transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-10 gap-4"
          >
            <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
              <XCircle className="w-7 h-7 text-red-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">Auto-Setup Failed</p>
              <p className="text-sm text-red-400/80 mt-1 max-w-md">
                {session.error ?? 'An unexpected error occurred during the browser session.'}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-lg hover:bg-secondary/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={session.startBrowser}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
