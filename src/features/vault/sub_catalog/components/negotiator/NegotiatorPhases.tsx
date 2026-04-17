import { motion } from 'framer-motion';
import { Loader2, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

const phaseVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const phaseTransition = { duration: 0.2 };

interface NegotiatorIdlePhaseProps {
  connectorLabel: string;
  authDetectLoading: boolean;
  onStart: () => void;
}

export function NegotiatorIdlePhase({ connectorLabel, authDetectLoading, onStart }: NegotiatorIdlePhaseProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="neg-idle"
      variants={phaseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={phaseTransition}
      className="space-y-3"
    >
      <p className="text-sm text-foreground/90">
        Let the AI guide you step-by-step through obtaining {connectorLabel} API credentials.
        It will open the right pages, tell you exactly what to click, and auto-capture your keys.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onStart}
          disabled={authDetectLoading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm font-medium hover:bg-violet-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {authDetectLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {authDetectLoading ? t.vault.negotiator_extra.detecting_auth : t.vault.negotiator_extra.start_auto}
        </button>
        {!authDetectLoading && (
          <span className="text-sm text-foreground">
            Takes ~{Math.ceil(60 / 60)}-2 minutes
          </span>
        )}
      </div>
    </motion.div>
  );
}

interface NegotiatorDonePhaseProps {
  capturedValuesCount: number;
  onFinish: () => void;
}

export function NegotiatorDonePhase({ capturedValuesCount, onFinish }: NegotiatorDonePhaseProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="neg-done"
      variants={phaseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={phaseTransition}
      className="flex flex-col items-center py-6 gap-3"
    >
      <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Zap className="w-5 h-5 text-emerald-400" />
      </div>
      <p className="text-sm text-foreground font-medium">{t.vault.negotiator.captured}</p>
      <p className="text-sm text-foreground">
        {capturedValuesCount} field(s) auto-filled from the provisioning flow.
      </p>
      <button
        onClick={onFinish}
        className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-modal text-sm font-medium transition-colors mt-1"
      >
        Apply to credential form
      </button>
    </motion.div>
  );
}

interface NegotiatorErrorPhaseProps {
  error: string | null;
  authDetectLoading: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export function NegotiatorErrorPhase({ error, authDetectLoading, onRetry, onClose }: NegotiatorErrorPhaseProps) {
  return (
    <motion.div
      key="neg-error"
      variants={phaseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={phaseTransition}
      className="space-y-3"
    >
      <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-modal">
        <p className="text-sm text-red-300">{error}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          disabled={authDetectLoading}
          className="px-4 py-2 rounded-modal bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Try again
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-modal text-foreground text-sm hover:text-foreground/95 transition-colors"
        >
          Close
        </button>
      </div>
    </motion.div>
  );
}
