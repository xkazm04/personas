import { useState, useCallback, useRef, useMemo } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('credential-negotiator');
import {
  startCredentialNegotiation,
  cancelCredentialNegotiation,
  getNegotiationStepHelp,
} from '@/api/vault/negotiator';
import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { EventName } from '@/lib/eventRegistry';
import { useStepProgress } from '@/hooks/useStepProgress';
import { lookupPlaybook, savePlaybook, markPlaybookUsed } from '../core/playbookCache';
import { resolveStepGraph, type StepGraphContext, type ResolvedSteps } from './negotiatorStepGraph';
import { saveRecipeFromDesign } from '@/lib/credentials/credentialRecipeRegistry';
import type { CredentialDesignConnector } from './useCredentialDesign';

// -- Types -------------------------------------------------------

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

/** Subset of AuthDetection relevant to the negotiator. */
export interface AuthDetectionInfo {
  serviceType: string;
  method: string;
  authenticated: boolean;
  identity: string | null;
  confidence: string;
}

/** Runtime context passed to the hook for step graph evaluation. */
export interface NegotiatorContext {
  /** Values already captured by autoCred or previously saved credentials */
  prefilledValues?: Record<string, string>;
  /** Whether the connector supports OAuth (has a non-null oauth_type) */
  hasOAuth?: boolean;
  /** Whether the connector has a healthcheck endpoint configured */
  hasHealthcheck?: boolean;
  /** Auth detection results for services the user is already authenticated to */
  authenticatedServices?: AuthDetectionInfo[];
}

const EMPTY_RESOLVED: ResolvedSteps = {
  visible: [],
  skipped: [],
  visibleToOriginal: [],
  originalToVisible: new Map(),
};

// -- Hook --------------------------------------------------------

export function useCredentialNegotiator(context?: NegotiatorContext) {
  const [stepHelp, setStepHelp] = useState<{ answer: string; stepIndex: number } | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const [fromPlaybook, setFromPlaybook] = useState(false);
  const serviceNameRef = useRef('');
  const startedAtRef = useRef(0);
  const helpedStepsRef = useRef<Set<number>>(new Set());
  /** Tracks completed steps via ref to avoid stale closure in completeStep callback. */
  const completedStepsRef = useRef<Set<number>>(new Set());

  const flow = useAiArtifactTask<[string, Record<string, unknown>, string[], Array<Record<string, unknown>> | undefined], NegotiationPlan>({
    progressEvent: 'credential-negotiation-progress',
    statusEvent: EventName.CREDENTIAL_NEGOTIATION_STATUS,
    runningPhase: 'planning',
    completedPhase: 'guiding',
    startFn: startCredentialNegotiation,
    cancelFn: cancelCredentialNegotiation,
    errorMessage: 'Failed to generate provisioning plan',
    traceOperation: 'credential_negotiation',
  });

  // -- Step graph resolution --
  // Resolve which steps are visible vs skipped based on runtime context.
  // Re-evaluates when the plan or captured values change so steps can
  // become skipped mid-flow (e.g. after autoCred fills fields).

  const prefilled = context?.prefilledValues ?? {};

  const authServices = context?.authenticatedServices ?? [];

  const graphContext = useMemo<StepGraphContext>(() => {
    const fieldKeys = flow.result
      ? flow.result.steps.flatMap((s) =>
          s.field_fills ? Object.keys(s.field_fills) : [],
        )
      : [];
    const allFieldsPrefilled =
      fieldKeys.length > 0 && fieldKeys.every((k) => prefilled[k]?.trim());

    return {
      prefilledValues: prefilled,
      hasOAuth: context?.hasOAuth ?? false,
      allFieldsPrefilled,
      hasHealthcheck: context?.hasHealthcheck ?? true,
      authenticatedServices: authServices,
    };
  }, [flow.result, prefilled, context?.hasOAuth, context?.hasHealthcheck, authServices]);

  const resolved = useMemo<ResolvedSteps>(() => {
    if (!flow.result) return EMPTY_RESOLVED;
    return resolveStepGraph(flow.result.steps, graphContext);
  }, [flow.result, graphContext]);

  // Use visible step count for progress tracking
  const visibleStepCount = resolved.visible.length;
  const sp = useStepProgress(visibleStepCount);

  const start = useCallback(async (
    serviceName: string,
    connector: Record<string, unknown>,
    fieldKeys: string[],
  ) => {
    serviceNameRef.current = serviceName;
    startedAtRef.current = Date.now();
    helpedStepsRef.current = new Set();
    completedStepsRef.current = new Set();
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

    // Cache the connector definition as a recipe for future reuse
    void saveRecipeFromDesign({
      match_existing: null,
      connector: connector as unknown as CredentialDesignConnector,
      setup_instructions: '',
      summary: '',
    }, 'negotiator').catch((err) => { logger.warn('Failed to cache recipe from negotiator (non-critical)', { error: String(err) }); });

    // Convert AuthDetectionInfo[] to plain records for the backend invoke
    const authForBackend = authServices.length > 0
      ? authServices.filter((s) => s.authenticated).map((s) => ({
          service_type: s.serviceType,
          method: s.method,
          authenticated: s.authenticated,
          identity: s.identity,
          confidence: s.confidence,
        }))
      : undefined;

    await flow.start(serviceName, connector, fieldKeys, authForBackend);
  }, [flow.start, flow.setResult, flow.setPhase, sp.reset, authServices]);

  // completeStep operates on visible indices -- translates to original for refs/playbook
  const completeStep = useCallback((visibleIndex: number) => {
    sp.completeStep(visibleIndex);

    // Track completion in ref so rapid clicks always see the latest count
    completedStepsRef.current.add(visibleIndex);
    const completedCount = completedStepsRef.current.size;

    // Transition to done when every visible step is marked complete
    if (flow.result && completedCount >= resolved.visible.length) {
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
  }, [flow.result, flow.setPhase, sp.completeStep, sp.capturedValues, resolved.visible.length]);

  const goToStep = useCallback((visibleIndex: number) => {
    sp.goToStep(visibleIndex);
    setStepHelp(null);
  }, [sp.goToStep]);

  const requestStepHelp = useCallback(async (visibleIndex: number, question: string) => {
    if (!flow.result) return;

    // Translate visible index to original plan step for the API call
    const originalIndex = resolved.visibleToOriginal[visibleIndex];
    if (originalIndex === undefined) return;
    const step = flow.result.steps[originalIndex];
    if (!step) return;

    helpedStepsRef.current.add(visibleIndex);
    setIsLoadingHelp(true);
    setStepHelp(null);

    try {
      const result = await getNegotiationStepHelp(
        serviceNameRef.current,
        originalIndex,
        step.title,
        question,
      );
      setStepHelp({ answer: result.answer, stepIndex: visibleIndex });
    } catch (err) {
      setStepHelp({
        answer: `Failed to get help: ${err instanceof Error ? err.message : 'Unknown error'}`,
        stepIndex: visibleIndex,
      });
    } finally {
      setIsLoadingHelp(false);
    }
  }, [flow.result, resolved.visibleToOriginal]);

  const reset = useCallback(() => {
    flow.reset();
    sp.reset();
    completedStepsRef.current = new Set();
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
    /** Resolved visible steps (skipped steps removed) */
    visibleSteps: resolved.visible,
    /** Steps that were skipped with reasons */
    skippedSteps: resolved.skipped,
    start,
    cancel: flow.cancel,
    completeStep,
    captureValue: sp.captureValue,
    goToStep,
    requestStepHelp,
    reset,
  };
}
