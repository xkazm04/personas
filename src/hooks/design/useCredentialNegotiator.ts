import { useState, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  startCredentialNegotiation,
  cancelCredentialNegotiation,
  getNegotiationStepHelp,
} from '@/api/negotiator';

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

interface NegotiationProgressPayload {
  negotiation_id: string;
  line: string;
}

interface NegotiationStatusPayload {
  negotiation_id: string;
  status: string;
  result?: NegotiationPlan;
  error?: string;
}

// ── Hook ────────────────────────────────────────────────────────

export function useCredentialNegotiator() {
  const [phase, setPhase] = useState<NegotiatorPhase>('idle');
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [plan, setPlan] = useState<NegotiationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [capturedValues, setCapturedValues] = useState<Record<string, string>>({});
  const [stepHelp, setStepHelp] = useState<{ answer: string; stepIndex: number } | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const serviceNameRef = useRef('');

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const start = useCallback(async (
    serviceName: string,
    connector: Record<string, unknown>,
    fieldKeys: string[],
  ) => {
    cleanup();
    serviceNameRef.current = serviceName;
    setPhase('planning');
    setProgressLines([]);
    setPlan(null);
    setError(null);
    setActiveStepIndex(0);
    setCompletedSteps(new Set());
    setCapturedValues({});
    setStepHelp(null);

    try {
      const unlistenProgress = await listen<NegotiationProgressPayload>(
        'credential-negotiation-progress',
        (event) => {
          setProgressLines((prev) => [...prev, event.payload.line]);
        },
      );

      const unlistenStatus = await listen<NegotiationStatusPayload>(
        'credential-negotiation-status',
        (event) => {
          const { status, result: planResult, error: planError } = event.payload;

          if (status === 'completed' && planResult) {
            setPlan(planResult);
            setPhase('guiding');
            cleanup();
          } else if (status === 'failed') {
            setError(planError || 'Failed to generate provisioning plan');
            setPhase('error');
            cleanup();
          }
        },
      );

      unlistenersRef.current = [unlistenProgress, unlistenStatus];

      await startCredentialNegotiation(serviceName, connector, fieldKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start negotiation');
      setPhase('error');
      cleanup();
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelCredentialNegotiation().catch(() => {});
    cleanup();
    setPhase('idle');
    setProgressLines([]);
    setError(null);
  }, [cleanup]);

  const completeStep = useCallback((stepIndex: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(stepIndex);
      return next;
    });

    // Auto-advance to next step
    if (plan && stepIndex < plan.steps.length - 1) {
      setActiveStepIndex(stepIndex + 1);
    }

    // Check if all steps are complete
    if (plan && stepIndex === plan.steps.length - 1) {
      // All steps completed — check all are marked
      setCompletedSteps((prev) => {
        const next = new Set(prev);
        next.add(stepIndex);
        if (next.size === plan.steps.length) {
          setPhase('done');
        }
        return next;
      });
    }
  }, [plan]);

  const captureValue = useCallback((fieldKey: string, value: string) => {
    setCapturedValues((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const goToStep = useCallback((stepIndex: number) => {
    setActiveStepIndex(stepIndex);
    setStepHelp(null);
  }, []);

  const requestStepHelp = useCallback(async (stepIndex: number, question: string) => {
    if (!plan) return;

    const step = plan.steps[stepIndex];
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
  }, [plan]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setProgressLines([]);
    setPlan(null);
    setError(null);
    setActiveStepIndex(0);
    setCompletedSteps(new Set());
    setCapturedValues({});
    setStepHelp(null);
  }, [cleanup]);

  return {
    phase,
    progressLines,
    plan,
    error,
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
