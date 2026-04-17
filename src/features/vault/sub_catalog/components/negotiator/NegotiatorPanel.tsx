import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X } from 'lucide-react';
import { useCredentialNegotiator, type NegotiatorContext, type AuthDetectionInfo } from '@/hooks/design/credential/useCredentialNegotiator';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { detectAuthenticatedServices } from '@/api/auth/authDetect';
import { NegotiatorPlanningPhase } from './NegotiatorPlanningPhase';
import { NegotiatorGuidingPhase } from './NegotiatorGuidingPhase';
import { NegotiatorIdlePhase, NegotiatorDonePhase, NegotiatorErrorPhase } from './NegotiatorPhases';
import { useTranslation } from '@/i18n/useTranslation';

const PHASE_VARIANTS = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };
const PHASE_TRANSITION = { duration: 0.2 };

interface NegotiatorPanelProps {
  designResult: CredentialDesignResult;
  onComplete: (capturedValues: Record<string, string>) => void;
  onClose: () => void;
  prefilledValues?: Record<string, string>;
  prefetchedAuthDetections?: AuthDetectionInfo[];
}

export function NegotiatorPanel({ designResult, onComplete, onClose, prefilledValues, prefetchedAuthDetections }: NegotiatorPanelProps) {
  const { t, tx } = useTranslation();
  const neg = t.vault.negotiator;
  const negx = t.vault.negotiator_extra;
  const hasPrefetched = prefetchedAuthDetections !== undefined;
  const [authDetections, setAuthDetections] = useState<AuthDetectionInfo[]>(hasPrefetched ? prefetchedAuthDetections : []);
  const [authDetectLoading, setAuthDetectLoading] = useState(!hasPrefetched);
  useEffect(() => {
    if (hasPrefetched) return;
    let cancelled = false;
    detectAuthenticatedServices()
      .then((detections) => {
        if (cancelled) return;
        const mapped: AuthDetectionInfo[] = detections
          .filter((d) => d.authenticated)
          .map((d) => ({
            serviceType: d.service_type,
            method: d.method,
            authenticated: d.authenticated,
            identity: d.identity,
            confidence: d.confidence,
          }));
        setAuthDetections(mapped);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAuthDetectLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasPrefetched]);

  const matchingAuth = useMemo(() => {
    if (authDetections.length === 0) return [];
    const label = designResult.connector.label.toLowerCase();
    const name = (designResult.connector.name ?? '').toLowerCase();
    return authDetections.filter((d) => {
      const st = d.serviceType.toLowerCase();
      return label.includes(st) || st.includes(label) || name.includes(st) || st.includes(name);
    });
  }, [authDetections, designResult.connector.label, designResult.connector.name]);

  const negotiatorContext = useMemo<NegotiatorContext>(() => ({
    prefilledValues: prefilledValues ?? {},
    hasOAuth: !!designResult.connector.oauth_type,
    hasHealthcheck: !!designResult.connector.healthcheck_config,
    authenticatedServices: matchingAuth,
  }), [prefilledValues, designResult.connector.oauth_type, designResult.connector.healthcheck_config, matchingAuth]);

  const negotiator = useCredentialNegotiator(negotiatorContext);

  const handleStart = () => {
    const fieldKeys = designResult.connector.fields.map((f) => f.key);
    negotiator.start(
      designResult.connector.label,
      designResult.connector as unknown as Record<string, unknown>,
      fieldKeys,
    );
  };

  const handleFinish = () => {
    onComplete(negotiator.capturedValues);
  };

  const handleClose = () => {
    if (negotiator.phase === 'planning') {
      negotiator.cancel();
    }
    onClose();
  };

  return (
    <div className="animate-fade-slide-in overflow-hidden">
      <div className="rounded-modal border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-card bg-violet-500/15 flex items-center justify-center">
              <Bot className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h3 className="typo-heading font-bold tracking-tight text-foreground">{negx.panel_title}</h3>
              <p className="typo-body text-foreground">
                {negotiator.phase === 'idle' && (authDetectLoading ? negx.checking_auth : negx.auto_provisioning)}
                {negotiator.phase === 'planning' && negx.generating_plan}
                {negotiator.phase === 'guiding' && tx(neg.provisioning_label, { label: designResult.connector.label })}
                {negotiator.phase === 'done' && neg.captured}
                {negotiator.phase === 'error' && neg.error_title}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors duration-snap"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {negotiator.phase === 'idle' && (
              <NegotiatorIdlePhase
                connectorLabel={designResult.connector.label}
                authDetectLoading={authDetectLoading}
                onStart={handleStart}
              />
            )}

            {negotiator.phase === 'planning' && (
              <motion.div
                key="neg-planning"
                variants={PHASE_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={PHASE_TRANSITION}
              >
                <NegotiatorPlanningPhase
                  progressLines={negotiator.progressLines}
                  onCancel={negotiator.cancel}
                />
              </motion.div>
            )}

            {negotiator.phase === 'guiding' && negotiator.plan && (
              <motion.div
                key="neg-guiding"
                variants={PHASE_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={PHASE_TRANSITION}
              >
                <NegotiatorGuidingPhase
                  plan={negotiator.plan}
                  activeStepIndex={negotiator.activeStepIndex}
                  completedSteps={negotiator.completedSteps}
                  capturedValues={negotiator.capturedValues}
                  stepHelp={negotiator.stepHelp}
                  isLoadingHelp={negotiator.isLoadingHelp}
                  visibleSteps={negotiator.visibleSteps}
                  skippedSteps={negotiator.skippedSteps}
                  onCompleteStep={negotiator.completeStep}
                  onSelectStep={negotiator.goToStep}
                  onCaptureValue={negotiator.captureValue}
                  onRequestHelp={negotiator.requestStepHelp}
                  onCancel={handleClose}
                  onFinish={handleFinish}
                />
              </motion.div>
            )}

            {negotiator.phase === 'done' && (
              <NegotiatorDonePhase
                capturedValuesCount={Object.keys(negotiator.capturedValues).length}
                onFinish={handleFinish}
              />
            )}

            {negotiator.phase === 'error' && (
              <NegotiatorErrorPhase
                error={negotiator.error}
                authDetectLoading={authDetectLoading}
                onRetry={handleStart}
                onClose={handleClose}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
