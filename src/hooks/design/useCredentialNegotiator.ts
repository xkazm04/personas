import { useState, useCallback, useRef } from 'react';
import {
  startCredentialNegotiation,
  cancelCredentialNegotiation,
  getNegotiationStepHelp,
} from '@/api/negotiator';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';

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
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [capturedValues, setCapturedValues] = useState<Record<string, string>>({});
  const [stepHelp, setStepHelp] = useState<{ answer: string; stepIndex: number } | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const serviceNameRef = useRef('');

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

  const start = useCallback(async (
    serviceName: string,
    connector: Record<string, unknown>,
    fieldKeys: string[],
  ) => {
    serviceNameRef.current = serviceName;
    setActiveStepIndex(0);
    setCompletedSteps(new Set());
    setCapturedValues({});
    setStepHelp(null);

    await flow.start({ serviceName, connector, fieldKeys });
  }, [flow.start]);

  const cancel = useCallback(() => {
    flow.cancel(() => cancelCredentialNegotiation());
  }, [flow.cancel]);

  const completeStep = useCallback((stepIndex: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(stepIndex);
      // Transition to done when every step is marked complete
      if (flow.result && next.size === flow.result.steps.length) {
        flow.setPhase('done');
      }
      return next;
    });

    // Auto-advance to next step
    if (flow.result && stepIndex < flow.result.steps.length - 1) {
      setActiveStepIndex(stepIndex + 1);
    }
  }, [flow.result, flow.setPhase]);

  const captureValue = useCallback((fieldKey: string, value: string) => {
    setCapturedValues((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const goToStep = useCallback((stepIndex: number) => {
    setActiveStepIndex(stepIndex);
    setStepHelp(null);
  }, []);

  const requestStepHelp = useCallback(async (stepIndex: number, question: string) => {
    if (!flow.result) return;

    const step = flow.result.steps[stepIndex];
    if (!step) return;

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
    setActiveStepIndex(0);
    setCompletedSteps(new Set());
    setCapturedValues({});
    setStepHelp(null);
  }, [flow.reset]);

  return {
    phase: flow.phase as NegotiatorPhase,
    progressLines: flow.lines,
    plan: flow.result,
    error: flow.error,
    activeStepIndex,
    completedSteps,
    capturedValues,
    stepHelp,
    isLoadingHelp,
    start,
    cancel,
    completeStep,
    captureValue,
    goToStep,
    requestStepHelp,
    reset,
  };
}
