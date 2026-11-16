import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Zap } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { PHASE_VARIANTS, PHASE_TRANSITION } from './negotiatorMotion';

interface NegotiatorIdlePhaseProps {
  connectorLabel: string;
  authDetectLoading: boolean;
  onStart: () => void;
  /**
   * Services the machine is ALREADY signed in to that match this connector.
   * The panel has always computed this and handed it to the step graph, which
   * skips the sign-in steps -- but the idle screen never read it, so a user
   * whose `gh auth status` was already good was still shown a generic
   * "Start auto-provisioning" with a two-minute estimate for work that had
   * mostly already happened. Route them to the session they have.
   */
  matchedAuth?: { serviceType: string; method: string }[];
}

export function NegotiatorIdlePhase({ connectorLabel, authDetectLoading, onStart, matchedAuth }: NegotiatorIdlePhaseProps) {
  const { t, tx } = useTranslation();
  const neg = t.vault.negotiator;
  const negx = t.vault.negotiator_extra;
  const existing = !authDetectLoading ? matchedAuth?.[0] : undefined;
  return (
    <motion.div
      key="neg-idle"
      variants={PHASE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PHASE_TRANSITION}
      className="space-y-3"
      data-testid="vault-negotiator-idle"
    >
      <p className="typo-body text-ink-1">
        {existing
          ? tx(negx.existing_auth_description, { service: connectorLabel, method: existing.method })
          : tx(neg.start_description, { label: connectorLabel })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onStart}
          disabled={authDetectLoading}
          data-testid="vault-negotiator-start"
          variant="accent"
          tone="agent"
          size="md"
          icon={authDetectLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : existing ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
        >
          {authDetectLoading
            ? negx.detecting_auth
            : existing
              ? tx(negx.use_existing_auth, { service: connectorLabel })
              : negx.start_auto}
        </Button>
        {/* The estimate is for a full guided capture. With a live session most
            of that plan is skipped, so quoting it would be misleading. */}
        {!authDetectLoading && !existing && (
          <span className="typo-body text-foreground">
            {tx(neg.estimated_time, { minutes: 2 })}
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
  const { t, tx } = useTranslation();
  const neg = t.vault.negotiator;
  return (
    <motion.div
      key="neg-done"
      variants={PHASE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PHASE_TRANSITION}
      className="flex flex-col items-center py-6 gap-3"
      data-testid="vault-negotiator-done"
    >
      <div className="w-10 h-10 rounded-full bg-status-success/15 flex items-center justify-center">
        <Zap className="w-5 h-5 text-status-success" />
      </div>
      <p className="typo-body text-foreground">{neg.captured}</p>
      <p className="typo-body text-foreground">
        {tx(neg.fields_captured, { count: capturedValuesCount })}
      </p>
      <Button
        type="button"
        onClick={onFinish}
        data-testid="vault-negotiator-apply"
        variant="accent"
        tone="success"
        size="md"
        className="mt-1"
      >
        {neg.apply_button}
      </Button>
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
  const { t } = useTranslation();
  const neg = t.vault.negotiator;
  return (
    <motion.div
      key="neg-error"
      variants={PHASE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PHASE_TRANSITION}
      className="space-y-3"
      data-testid="vault-negotiator-error"
    >
      <div className="px-4 py-3 bg-status-error/10 border border-status-error/20 rounded-modal">
        <p className="typo-body text-status-error">{error}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onRetry} disabled={authDetectLoading}>
          {neg.try_again}
        </Button>
        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="md"
        >
          {t.common.close}
        </Button>
      </div>
    </motion.div>
  );
}
