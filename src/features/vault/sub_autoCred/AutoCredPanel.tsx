import { useState, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, CheckCircle2 } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from './types';
import { useAutoCredSession } from './useAutoCredSession';
import { tauriPlaywrightAdapter, tauriGuidedAdapter } from './TauriPlaywrightAdapter';
import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { AutoCredConsent } from './AutoCredConsent';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredReview } from './AutoCredReview';
import { AutoCredBrowserError } from './AutoCredBrowserError';
import { AutoCredErrorDisplay } from './AutoCredErrorDisplay';

interface AutoCredPanelProps {
  designResult: CredentialDesignResult;
  onComplete: () => void;
  onCancel: () => void;
}

export function AutoCredPanel({ designResult, onComplete, onCancel }: AutoCredPanelProps) {
  const [mode, setMode] = useState<AutoCredMode>('playwright');
  const [modeChecked, setModeChecked] = useState(false);

  // Check Playwright availability on mount
  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => {
        setMode(available ? 'playwright' : 'guided');
        setModeChecked(true);
      })
      .catch(() => {
        setMode('guided');
        setModeChecked(true);
      });
  }, []);

  const adapter = mode === 'guided' ? tauriGuidedAdapter : tauriPlaywrightAdapter;
  const session = useAutoCredSession({ adapter });

  // Kill running browser session on unmount (e.g. wizard closed, navigated away).
  // Store cancelBrowser in a ref so the cleanup always targets the current session,
  // not the stale closure captured at mount time.
  const sessionPhaseRef = useRef(session.phase);
  sessionPhaseRef.current = session.phase;
  const cancelBrowserRef = useRef(session.cancelBrowser);
  cancelBrowserRef.current = session.cancelBrowser;
  useEffect(() => {
    return () => {
      if (sessionPhaseRef.current === 'browser') {
        cancelBrowserRef.current();
      }
    };
  }, []);
  const fieldsHash = useMemo(() => {
    return designResult.connector.fields
      .map((f) => `${f.key}:${f.type}:${f.required ? '1' : '0'}`)
      .join('|');
  }, [designResult.connector.fields]);

  // Initialize session when design result arrives and mode is resolved
  useEffect(() => {
    if (modeChecked) {
      session.init(designResult);
    }
  }, [designResult.connector.name, fieldsHash, modeChecked]);

  const handleCancel = () => {
    session.reset();
    onCancel();
  };

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <AutoCredConsent
            key="consent"
            designResult={designResult}
            onConsent={session.startBrowser}
            onCancel={handleCancel}
            mode={mode}
          />
        )}

        {session.phase === 'browser' && (
          <AutoCredBrowser
            key="browser"
            logs={session.logs}
            onCancel={session.cancelBrowser}
            mode={mode}
          />
        )}

        {session.phase === 'browser-error' && session.error && (
          <AutoCredBrowserError
            key="browser-error"
            logs={session.logs}
            error={session.error}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
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
            isPartial={session.isPartial}
            completeness={session.completeness}
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
              className="px-4 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-xl text-sm font-medium transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && session.error && (
          <AutoCredErrorDisplay
            key="error"
            error={session.error}
            logs={session.logs}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
