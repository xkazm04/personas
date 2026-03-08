import { useState, useCallback, useRef } from 'react';
import {
  startCredentialNegotiation,
  cancelCredentialNegotiation,
  getNegotiationStepHelp,
} from '@/api/negotiator';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';
import { useStepProgress } from '@/hooks/useStepProgress';
import { lookupPlaybook, savePlaybook, markPlaybookUsed } from './playbookCache';

// ── Types ───────────────────────────────────────────────────────

export type NegotiatorPhase = 'idle' | 'planning' | 'guiding' | 'done' | 'error';

export interface NegotiationStep {
  title: string;
  description: string;
  action_type: 'navigate' | 'configure' | 'create_account' | 'authorize' | 'capture' | 'verify';
  url: string | null;
  requires_human: boolean;
  field_fills: Record<string, string> | null;
  visual_hint: string | null;
  wait_for: string | null;
}

export interface NegotiationPlan {
  service_name: string;
  estimated_time_seconds: number;
  prerequisites: string[];
  steps: NegotiationStep[];
  verification_hint: string;
  tips: string[];
}

/** Prompt input for the negotiator flow: (serviceName, connector, fieldKeys) */
interface NegotiationInput {
  serviceName: string;
  connector: Record<string, unknown>;
  fieldKeys: string[];
}

// ── Hook ────────────────────────────────────────────────────────

export function useCredentialNegotiator() {
  const [stepHelp, setStepHelp] = useState<{ answer: string; stepIndex: number } | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const [fromPlaybook, setFromPlaybook] = useState(false);
  const serviceNameRef = useRef('');
  const startedAtRef = useRef(0);
  const helpedStepsRef = useRef<Set<number>>(new Set());

  const flow = useAiArtifactFlow<NegotiationInput, NegotiationPlan>({
    stream: {
      progressEvent: 'credential-negotiation-progress',
      statusEvent: 'credential-negotiation-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Failed to generate provisioning plan'),
      completedPhase: 'guiding',
      runningPhase: 'planning',
      startErrorMessage: 'Failed to start negotiation',
    },
    startFn: ({ serviceName, connector, fieldKeys }) =>
      startCredentialNegotiation(serviceName, connector, fieldKeys),
  });

  // Derive totalSteps from plan — this re-renders when flow.result changes
  const totalSteps = flow.result?.steps.length ?? 0;
  const sp = useStepProgress(totalSteps);

  const start = useCallback(async (
    serviceName: string,
    connector: Record<string, unknown>,
    fieldKeys: string[],
  ) => {
    serviceNameRef.current = serviceName;
    startedAtRef.current = Date.now();
    helpedStepsRef.current = new Set();
    sp.reset();
    setStepHelp(null);
    setFromPlaybook(false);

    // Lookup-before-generate: check if a successful playbook exists for this service
    const cached = lookupPlaybook(serviceName);
    if (cached) {
      markPlaybookUsed(serviceName);
      setFromPlaybook(true);
      // Inject the cached plan directly, skipping AI generation
      flow.setResult(cached.plan);
      flow.setPhase('guiding');
      return;
    }

    await flow.start({ serviceName, connector, fieldKeys });
  }, [flow.start, flow.setResult, flow.setPhase, sp.reset]);

  const cancel = useCallback(() => {
    flow.cancel(() => cancelCredentialNegotiation());
  }, [flow.cancel]);

  const completeStep = useCallback((stepIndex: number) => {
    sp.completeStep(stepIndex);

    // Transition to done when every step is marked complete
    if (flow.result) {
      // +1 because the step we just completed isn't in completedSteps yet
      // (state update is async), so check count manually
      const willBeComplete = sp.completedSteps.size + (sp.completedSteps.has(stepIndex) ? 0 : 1);
      if (willBeComplete >= flow.result.steps.length) {
        flow.setPhase('done');

        // Record successful playbook for future reuse
        savePlaybook({
          serviceName: serviceNameRef.current,
          plan: flow.result,
          outcome: 'success',
          durationMs: Date.now() - startedAtRef.current,
          stepsNeedingHelp: [...helpedStepsRef.current],
          capturedFieldCount: Object.keys(sp.capturedValues).length,
          usedAt: new Date().toISOString(),
          usageCount: 0,
        });
      }
    }
  }, [flow.result, flow.setPhase, sp.completeStep, sp.completedSteps, sp.capturedValues]);

  const goToStep = useCallback((stepIndex: number) => {
    sp.goToStep(stepIndex);
    setStepHelp(null);
  }, [sp.goToStep]);

  const requestStepHelp = useCallback(async (stepIndex: number, question: string) => {
    if (!flow.result) return;

    const step = flow.result.steps[stepIndex];
    if (!step) return;

    helpedStepsRef.current.add(stepIndex);
    setIsLoadingHelp(true);
    setStepHelp(null);

    try {
      const result = await getNegotiationStepHelp(
        serviceNameRef.current,
        stepIndex,
        step.title,
        question,
      );
      setStepHelp({ answer: result.answer, stepIndex });
    } catch (err) {
      setStepHelp({
        answer: `Failed to get help: ${err instanceof Error ? err.message : 'Unknown error'}`,
        stepIndex,
      });
    } finally {
      setIsLoadingHelp(false);
    }
  }, [flow.result]);

  const reset = useCallback(() => {
    flow.reset();
    sp.reset();
    setStepHelp(null);
  }, [flow.reset, sp.reset]);

  return {
    phase: flow.phase as NegotiatorPhase,
    progressLines: flow.lines,
    plan: flow.result,
    error: flow.error,
    activeStepIndex: sp.activeStepIndex,
    completedSteps: sp.completedSteps,
    capturedValues: sp.capturedValues,
    stepHelp,
    isLoadingHelp,
    fromPlaybook,
    start,
    cancel,
    completeStep,
    captureValue: sp.captureValue,
    goToStep,
    requestStepHelp,
    reset,
  };
}
