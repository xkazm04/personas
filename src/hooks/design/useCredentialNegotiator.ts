import { useState, useCallback, useRef } from 'react';
import {
  startCredentialNegotiation,
  cancelCredentialNegotiation,
  getNegotiationStepHelp,
} from '@/api/negotiator';
import { useTauriStream } from './useTauriStream';

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

const getLine = (payload: Record<string, unknown>) => payload.line as string;

const resolveStatus = (payload: Record<string, unknown>) => {
  const status = payload.status as string;
  if (status === 'completed' && payload.result) {
    return { result: payload.result as NegotiationPlan };
  }
  if (status === 'failed') {
    return { error: (payload.error as string) || 'Failed to generate provisioning plan' };
  }
  return null;
};

// ── Hook ────────────────────────────────────────────────────────

export function useCredentialNegotiator() {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [capturedValues, setCapturedValues] = useState<Record<string, string>>({});
  const [stepHelp, setStepHelp] = useState<{ answer: string; stepIndex: number } | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const serviceNameRef = useRef('');

  const stream = useTauriStream<NegotiationPlan>({
    progressEvent: 'credential-negotiation-progress',
    statusEvent: 'credential-negotiation-status',
    getLine,
    resolveStatus,
    completedPhase: 'guiding',
    runningPhase: 'planning',
    startErrorMessage: 'Failed to start negotiation',
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

    await stream.start(() => startCredentialNegotiation(serviceName, connector, fieldKeys));
  }, [stream.start]);

  const cancel = useCallback(() => {
    stream.cancel(() => cancelCredentialNegotiation());
  }, [stream.cancel]);

  const completeStep = useCallback((stepIndex: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(stepIndex);
      // Transition to done when every step is marked complete
      if (stream.result && next.size === stream.result.steps.length) {
        stream.setPhase('done');
      }
      return next;
    });

    // Auto-advance to next step
    if (stream.result && stepIndex < stream.result.steps.length - 1) {
      setActiveStepIndex(stepIndex + 1);
    }
  }, [stream.result, stream.setPhase]);

  const captureValue = useCallback((fieldKey: string, value: string) => {
    setCapturedValues((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const goToStep = useCallback((stepIndex: number) => {
    setActiveStepIndex(stepIndex);
    setStepHelp(null);
  }, []);

  const requestStepHelp = useCallback(async (stepIndex: number, question: string) => {
    if (!stream.result) return;

    const step = stream.result.steps[stepIndex];
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
  }, [stream.result]);

  const reset = useCallback(() => {
    stream.reset();
    setActiveStepIndex(0);
    setCompletedSteps(new Set());
    setCapturedValues({});
    setStepHelp(null);
  }, [stream.reset]);

  return {
    phase: stream.phase as NegotiatorPhase,
    progressLines: stream.lines,
    plan: stream.result,
    error: stream.error,
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
