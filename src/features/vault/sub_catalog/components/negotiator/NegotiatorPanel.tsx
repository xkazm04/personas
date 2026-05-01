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
import { silentCatch } from '@/lib/silentCatch';
import { PHASE_VARIANTS, PHASE_TRANSITION } from './negotiatorMotion';

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
      .catch(silentCatch('NegotiatorPanel:detectAuthenticatedServices'))
      .finally(() => {
        if (!cancelled) setAuthDetectLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasPrefetched]);

  const matchingAuth = useMemo(() => {
    if (authDetections.length === 0) return [];
    // Normalize to lowercase + drop non-alphanumerics so "GitHub", "github",
    // and "git-hub" all collapse to "github". Exact-equality after normalize
    // avoids the bidirectional substring trap where "git" matched "github",
    // "gitlab", and "git-anything".
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const label = normalize(designResult.connector.label);
    const name = normalize(designResult.connector.name ?? '');
    return authDetections.filter((d) => {
      const st = normalize(d.serviceType);
      return st === label || (name !== '' && st === name);
    });
  }, [authDetections, designResult.connector.label, designResult.connector.name]);

  const negotiatorContext = useMemo<NegotiatorContext>(() => ({
    prefilledValues: prefilledValues ?? {},
    hasOAuth: !!designResult.connector.oauth_type,
    hasHealthcheck: !!designResult.connector.healthcheck_config,
    authenticatedServices: matchingAuth,
  }), [prefilledValues, designResult.connector.oauth_type, designResult.connector.healthcheck_config, matchingAuth]);

  const negotiator = useCredentialNegotiator(negotiatorContext);

  // Phase → header subtitle. Centralized so adding a new phase requires
  // touching one place, not a 5-branch JSX ternary chain.
  const phaseSubtitle = (() => {
    switch (negotiator.phase) {
      case 'idle':
        return authDetectLoading ? negx.checking_auth : negx.auto_provisioning;
      case 'planning':
        return negx.generating_plan;
      case 'guiding':
        return tx(neg.provisioning_label, { label: designResult.connector.label });
      case 'done':
        return neg.captured;
      case 'error':
        return neg.error_title;
    }
  })();

  const handleStart = () => {
    const fieldKeys = designResult.connector.fields.map((f) => f.key);
    negotiator.start(
      designResult.connector.label,
      designResult.connector,
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
              <p className="typo-body text-foreground">{phaseSubtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground transition-colors duration-snap"
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
