import { CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { TRANSITION_SLOW } from '@/features/templates/animationPresets';
import type { AutoCredMode } from '../helpers/types';
import type { AutoCredSessionReturn } from '../helpers/useAutoCredSession';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredBrowserError } from './AutoCredBrowserError';
import { AutoCredErrorDisplay } from '../display/AutoCredErrorDisplay';
import { UniversalAutoCredReview } from './UniversalAutoCredReview';
import { useTranslation } from '@/i18n/useTranslation';

const phaseTransition = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: TRANSITION_SLOW },
  exit: { opacity: 0, x: -24, transition: { ...TRANSITION_SLOW, duration: 0.25 } },
};

interface UniversalAutoCredRunningPhaseProps {
  session: AutoCredSessionReturn;
  mode: AutoCredMode;
  universalSaving: boolean;
  onUniversalSave: () => void;
  onCancel: () => void;
  onComplete: () => void;
}

export function UniversalAutoCredRunningPhase({
  session,
  mode,
  universalSaving,
  onUniversalSave,
  onCancel,
  onComplete,
}: UniversalAutoCredRunningPhaseProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <motion.div key="starting" {...phaseTransition} className="flex items-center justify-center py-8">
            <LoadingSpinner size="xl" className="text-indigo-400" />
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
              onCancel={onCancel}
            />
          </motion.div>
        )}

        {session.phase === 'review' && session.designResult && (
          <motion.div key="review" {...phaseTransition}>
            <UniversalAutoCredReview
              designResult={session.designResult}
              credentialName={session.credentialName}
              onCredentialNameChange={session.setCredentialName}
              extractedValues={session.extractedValues}
              onValueChange={session.updateValue}
              onSave={onUniversalSave}
              onRetry={session.startBrowser}
              onCancel={onCancel}
              isSaving={universalSaving}
              isPartial={session.isPartial}
              discoveredFields={session.discoveredFields}
              discoveredConnector={session.discoveredConnector}
            />
          </motion.div>
        )}

        {session.phase === 'saving' && (
          <motion.div
            key="saving"
            {...phaseTransition}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <LoadingSpinner size="2xl" className="text-indigo-400" />
            <p className="typo-body text-foreground">{t.vault.auto_cred_extra.saving_connector}</p>
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
                {session.discoveredConnector?.label ?? 'Service'} credential has been securely stored.
              </p>
            </div>
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-modal typo-body font-medium transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && session.error && (
          <motion.div key="error" {...phaseTransition}>
            <AutoCredErrorDisplay
              error={session.error}
              logs={session.logs}
              onRetry={session.startBrowser}
              onCancel={onCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
