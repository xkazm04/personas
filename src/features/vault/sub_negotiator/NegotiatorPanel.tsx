import { useEffect, useMemo, useState } from 'react';
import { Bot, X, Zap } from 'lucide-react';
import { useCredentialNegotiator, type NegotiatorContext, type AuthDetectionInfo } from '@/hooks/design/credential/useCredentialNegotiator';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { detectAuthenticatedServices } from '@/api/auth/authDetect';
import { NegotiatorPlanningPhase } from './NegotiatorPlanningPhase';
import { NegotiatorGuidingPhase } from './NegotiatorGuidingPhase';

interface NegotiatorPanelProps {
  /** The credential design result with connector info and field definitions */
  designResult: CredentialDesignResult;
  /** Called when negotiation completes with captured values */
  onComplete: (capturedValues: Record<string, string>) => void;
  /** Called when the user closes/cancels the negotiator */
  onClose: () => void;
  /** Optional pre-filled values from autoCred or existing credentials */
  prefilledValues?: Record<string, string>;
}

export function NegotiatorPanel({ designResult, onComplete, onClose, prefilledValues }: NegotiatorPanelProps) {
  // Fetch auth detections on mount so the negotiator can skip steps for
  // services the user is already authenticated to.
  const [authDetections, setAuthDetections] = useState<AuthDetectionInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    detectAuthenticatedServices()
      .then((detections) => {
        if (cancelled) return;
        // Map backend snake_case to frontend camelCase and keep only authenticated entries
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
      .catch(() => {
        // Non-critical — negotiator works without auth detection
      });
    return () => { cancelled = true; };
  }, []);

  // Filter auth detections to those matching the current connector's service name
  const matchingAuth = useMemo(() => {
    if (authDetections.length === 0) return [];
    const label = designResult.connector.label.toLowerCase();
    const name = (designResult.connector.name ?? '').toLowerCase();
    return authDetections.filter((d) => {
      const st = d.serviceType.toLowerCase();
      return label.includes(st) || st.includes(label) || name.includes(st) || st.includes(name);
    });
  }, [authDetections, designResult.connector.label, designResult.connector.name]);

  // Derive step graph context from the connector's capabilities
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
    <div
      className="animate-fade-slide-in overflow-hidden"
    >
      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Bot className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-foreground">AI Credential Negotiator</h3>
              <p className="text-sm text-muted-foreground">
                {negotiator.phase === 'idle' && 'Automated API key provisioning'}
                {negotiator.phase === 'planning' && 'Generating provisioning plan...'}
                {negotiator.phase === 'guiding' && `Provisioning ${designResult.connector.label}`}
                {negotiator.phase === 'done' && 'Credentials captured'}
                {negotiator.phase === 'error' && 'Something went wrong'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors duration-snap"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {/* Idle -- show the start button */}
            {negotiator.phase === 'idle' && (
              <div
                key="neg-idle"
                className="animate-fade-slide-in space-y-3"
              >
                <p className="text-sm text-foreground/90">
                  Let the AI guide you step-by-step through obtaining {designResult.connector.label} API credentials.
                  It will open the right pages, tell you exactly what to click, and auto-capture your keys.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStart}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm font-medium hover:bg-violet-500/25 transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    Start auto-provisioning
                  </button>
                  <span className="text-sm text-muted-foreground/80">
                    Takes ~{Math.ceil(60 / 60)}-2 minutes
                  </span>
                </div>
              </div>
            )}

            {/* Planning */}
            {negotiator.phase === 'planning' && (
              <NegotiatorPlanningPhase
                progressLines={negotiator.progressLines}
                onCancel={negotiator.cancel}
              />
            )}

            {/* Guiding */}
            {negotiator.phase === 'guiding' && negotiator.plan && (
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
            )}

            {/* Done */}
            {negotiator.phase === 'done' && (
              <div
                key="neg-done"
                className="animate-fade-slide-in flex flex-col items-center py-6 gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm text-foreground font-medium">Credentials captured</p>
                <p className="text-sm text-muted-foreground/90">
                  {Object.keys(negotiator.capturedValues).length} field(s) auto-filled from the provisioning flow.
                </p>
                <button
                  onClick={handleFinish}
                  className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors mt-1"
                >
                  Apply to credential form
                </button>
              </div>
            )}

            {/* Error */}
            {negotiator.phase === 'error' && (
              <div
                key="neg-error"
                className="animate-fade-slide-in space-y-3"
              >
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-sm text-red-300">{negotiator.error}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleStart}
                    className="px-4 py-2 rounded-xl bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 text-sm transition-colors"
                  >
                    Try again
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 rounded-xl text-muted-foreground/90 text-sm hover:text-foreground/95 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
