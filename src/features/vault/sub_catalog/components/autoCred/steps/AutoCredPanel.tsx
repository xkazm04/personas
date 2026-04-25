import { useState, useEffect, useMemo, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred');
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { TRANSITION_SLOW } from '@/features/templates/animationPresets';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from '../helpers/types';
import { useAutoCredSession } from '../helpers/useAutoCredSession';
import { tauriPlaywrightAdapter, tauriGuidedAdapter } from '../helpers/TauriPlaywrightAdapter';
import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { AutoCredConsent } from './AutoCredConsent';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredReview } from './AutoCredReview';
import { usePostSaveResourcePicker } from '@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker';
import { AutoCredBrowserError } from './AutoCredBrowserError';
import { AutoCredErrorDisplay } from '../display/AutoCredErrorDisplay';
import { useTranslation } from '@/i18n/useTranslation';

interface AutoCredPanelProps {
  designResult: CredentialDesignResult;
  onComplete: () => void;
  onCancel: () => void;
}

export function AutoCredPanel({ designResult, onComplete, onCancel }: AutoCredPanelProps) {
  const { t, tx } = useTranslation();
  const [mode, setMode] = useState<AutoCredMode>('playwright');
  const [modeChecked, setModeChecked] = useState(false);

  // Check Playwright availability on mount
  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => {
        setMode(available ? 'playwright' : 'guided');
        setModeChecked(true);
      })
      .catch((err) => {
        logger.warn('Playwright availability check failed, falling back to guided mode', { error: String(err) });
        setMode('guided');
        setModeChecked(true);
      });
  }, []);

  const adapter = mode === 'guided' ? tauriGuidedAdapter : tauriPlaywrightAdapter;
  const session = useAutoCredSession({ adapter });
  // Picker dispatch — global <ResourcePickerHost /> renders the modal.
  const { promptIfScoped } = usePostSaveResourcePicker();

  /**
   * Wrap session.save so a successful save triggers the post-save resource
   * scope picker. No-op for connectors without `resources[]`. List-endpoint
   * errors surface inside the picker, so we don't gate behind a pre-save
   * healthcheck — let the user see the picker even if their token is bad.
   */
  const handleSave = async () => {
    const result = await session.save();
    if (result) {
      await promptIfScoped({ credentialId: result.id, serviceType: result.serviceType });
    }
  };

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

  const phaseTransition = {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0, transition: TRANSITION_SLOW },
    exit: { opacity: 0, x: -24, transition: { ...TRANSITION_SLOW, duration: 0.25 } },
  };

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <motion.div key="consent" {...phaseTransition}>
            <AutoCredConsent
              designResult={designResult}
              onConsent={session.startBrowser}
              onCancel={handleCancel}
              mode={mode}
            />
          </motion.div>
        )}

        {session.phase === 'browser' && (
          <motion.div key="browser" {...phaseTransition}>
            <AutoCredBrowser
              logs={session.logs}
              onCancel={session.cancelBrowser}
              mode={mode}
            />
          </motion.div>
        )}

        {session.phase === 'browser-error' && session.error && (
          <motion.div key="browser-error" {...phaseTransition}>
            <AutoCredBrowserError
              logs={session.logs}
              error={session.error}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
            />
          </motion.div>
        )}

        {session.phase === 'review' && (
          <motion.div key="review" {...phaseTransition}>
            <AutoCredReview
              designResult={designResult}
              credentialName={session.credentialName}
              onCredentialNameChange={session.setCredentialName}
              extractedValues={session.extractedValues}
              onValueChange={session.updateValue}
              onHealthcheck={session.runHealthcheck}
              healthResult={session.healthResult}
              onSave={handleSave}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
              isSaving={session.isSaving}
              isPartial={session.isPartial}
              completeness={session.completeness}
            />
          </motion.div>
        )}

        {session.phase === 'saving' && (
          <motion.div
            key="saving"
            {...phaseTransition}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <LoadingSpinner size="2xl" className="text-emerald-400" />
            <p className="typo-body text-foreground">{t.vault.design_phases.saving}</p>
          </motion.div>
        )}

        {session.phase === 'done' && (
          <motion.div
            key="done"
            {...phaseTransition}
            className="flex flex-col items-center justify-center py-10 gap-4"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="typo-body-lg font-semibold text-foreground">{t.vault.auto_cred_extra.credential_saved}</p>
              <p className="typo-body text-foreground mt-1">
                {tx(t.vault.auto_cred_extra.credential_stored, { label: designResult.connector.label })}
              </p>
            </div>
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-modal typo-body font-medium transition-colors"
            >
              {t.common.done}
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && session.error && (
          <motion.div key="error" {...phaseTransition}>
            <AutoCredErrorDisplay
              error={session.error}
              logs={session.logs}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
