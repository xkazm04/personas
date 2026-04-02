import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { startDesignAnalysis, refineDesign, cancelDesignAnalysis, compileFromIntent } from '@/api/templates/design';
import { useAgentStore } from "@/stores/agentStore";
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from "@/lib/silentCatch";
import { useTauriStream } from './useTauriStream';
import { applyDesignResult, retryFailedOperations, type ApplyDesignSelections, type FailedOperation } from '../credential/applyDesignResult';
import type { DesignPhase, AgentIR, DesignQuestion } from '@/lib/types/designTypes';
import { designPhaseFSM } from '@/lib/fsm';
import { SystemTraceSession } from '@/lib/execution/systemTrace';

// -- Stream outcome discriminator ------------------------------------
// The design status event produces three outcomes (result, question, error).
// useTauriStream natively handles result + error; we encode questions as
// a result variant and route them in a useEffect.

type DesignStreamOutcome =
  | { kind: 'result'; data: AgentIR }
  | { kind: 'question'; data: DesignQuestion };

const MAX_OUTPUT_LINES = 500;

// -- Hook ------------------------------------------------------------

export function useDesignAnalysis() {
  // Design result preview state.  This is a transient cache of the latest
  // stream result, used for immediate preview while the persona store catches
  // up.  The canonical source of truth is persona.last_design_result in the DB
  // (written by the backend on every successful analysis).  After each
  // completion we refresh the persona store so the two stay in sync.
  const [designResult, setDesignResult] = useState<AgentIR | null>(null);
  const [designPhase, setDesignPhaseRaw] = useState<DesignPhase>('idle');
  const [question, setQuestion] = useState<DesignQuestion | null>(null);

  // FSM-validated phase setter -- logs warning and ignores invalid transitions
  const designPhaseRef = useRef<DesignPhase>(designPhase);
  designPhaseRef.current = designPhase;
  const setDesignPhase = useCallback((next: DesignPhase | ((prev: DesignPhase) => DesignPhase)) => {
    if (typeof next === 'function') {
      setDesignPhaseRaw((prev) => {
        const target = next(prev);
        return designPhaseFSM.tryTransition(prev, target) ?? prev;
      });
    } else {
      setDesignPhaseRaw((prev) => designPhaseFSM.tryTransition(prev, next) ?? prev);
    }
  }, []);
  const [applyWarnings, setApplyWarnings] = useState<string[]>([]);
  const [failedOperations, setFailedOperations] = useState<FailedOperation[]>([]);

  const personaIdRef = useRef<string | null>(null);
  const designIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const applyingRef = useRef(false);
  const traceSessionRef = useRef<SystemTraceSession | null>(null);

  // Stream option callbacks as closures capturing the local designIdRef.
  // The ref object is stable across renders so useCallback produces a stable identity.
  const getLine = useCallback((payload: Record<string, unknown>): string => {
    if (designIdRef.current && payload.design_id !== designIdRef.current) return '';
    return payload.line as string;
  }, []);

  const resolveStatus = useCallback((payload: Record<string, unknown>):
    | { result: DesignStreamOutcome }
    | { error: string }
    | null => {
    if (designIdRef.current && payload.design_id !== designIdRef.current) return null;
    const status = payload.status as string;
    if (status === 'completed' && payload.result) {
      return { result: { kind: 'result', data: payload.result as AgentIR } };
    }
    if (status === 'awaiting-input' && payload.question) {
      return { result: { kind: 'question', data: payload.question as DesignQuestion } };
    }
    if (status === 'failed') {
      return { error: (payload.error as string) || 'Design analysis failed' };
    }
    return null;
  }, []);

  const applyPersonaOp = useAgentStore((s) => s.applyPersonaOp);
  const refreshPersonas = useAgentStore((s) => s.fetchPersonas);

  // -- Core streaming via useTauriStream -----------------------------
  // Handles: listener lifecycle, line accumulation, cleanup on unmount,
  // timeout, and basic phase + error management.
  const stream = useTauriStream<DesignStreamOutcome>({
    progressEvent: 'design-output',
    statusEvent: EventName.DESIGN_STATUS,
    getLine,
    resolveStatus,
    completedPhase: '__design_done__',
    runningPhase: '__design_running__',
  });

  // -- Route stream outcomes to design-specific state ----------------

  useEffect(() => {
    const outcome = stream.result;
    if (!outcome) return;

    if (outcome.kind === 'result') {
      setDesignResult(outcome.data);
      setQuestion(null);
      setDesignPhase('preview');
      traceSessionRef.current?.complete();
      traceSessionRef.current = null;
      // Refresh the persona store so persona.last_design_result (the canonical
      // source of truth, already written by the backend) is available to all
      // consumers without relying on this transient preview state.
      refreshPersonas().catch(silentCatch("designAnalysis:refreshAfterComplete"));
    } else if (outcome.kind === 'question') {
      setQuestion(outcome.data);
      setDesignPhase('awaiting-input');
    }
  }, [stream.result]);

  // Route stream errors -- refine failures fall back to 'preview' (preserving
  // the previous result), while analysis failures go to 'error'.
  useEffect(() => {
    if (stream.phase === 'error' && stream.error) {
      setDesignPhase((prev) => (prev === 'refining' ? 'preview' : 'error'));
      traceSessionRef.current?.complete(stream.error);
      traceSessionRef.current = null;
    }
  }, [stream.phase, stream.error]);

  // -- Derived output (filtered empty strings from design-id guard + capped) --
  const outputLines = useMemo(() => {
    const filtered = stream.lines.filter(Boolean);
    return filtered.length > MAX_OUTPUT_LINES ? filtered.slice(-MAX_OUTPUT_LINES) : filtered;
  }, [stream.lines]);

  // -- Start methods -------------------------------------------------

  const startAnalysis = useCallback(async (
    personaId: string,
    instruction: string,
    conversationId?: string | null,
  ) => {
    personaIdRef.current = personaId;
    conversationIdRef.current = conversationId ?? null;
    const clientDesignId = crypto.randomUUID();
    designIdRef.current = clientDesignId;

    setDesignPhase('analyzing');
    setDesignResult(null);
    setQuestion(null);
    setApplyWarnings([]);
    setFailedOperations([]);

    traceSessionRef.current?.complete('cancelled');
    traceSessionRef.current = SystemTraceSession.start('design_conversation', 'Design Analysis');

    await stream.start(() => startDesignAnalysis(instruction, personaId, clientDesignId));
  }, [stream.start]);

  const startIntentCompilation = useCallback(async (personaId: string, intent: string) => {
    personaIdRef.current = personaId;
    conversationIdRef.current = null;
    const clientDesignId = crypto.randomUUID();
    designIdRef.current = clientDesignId;

    setDesignPhase('analyzing');
    setDesignResult(null);
    setQuestion(null);
    setApplyWarnings([]);
    setFailedOperations([]);

    await stream.start(() => compileFromIntent(personaId, intent, clientDesignId));
  }, [stream.start]);

  const refineAnalysis = useCallback(async (feedback: string) => {
    if (!personaIdRef.current) return;
    // Read from the persona store's last_design_result (the canonical source,
    // already written by the backend on every successful analysis).  Falls back
    // to the local preview state only if the store hasn't refreshed yet.
    const store = useAgentStore.getState();
    const persona = store.personas.find((p) => p.id === personaIdRef.current);
    const canonicalResult = persona?.last_design_result ?? null;
    const currentResultJson = canonicalResult
      ?? (designResult ? JSON.stringify(designResult) : null);
    const clientDesignId = crypto.randomUUID();
    designIdRef.current = clientDesignId;

    setDesignPhase('refining');
    setQuestion(null);
    // Note: designResult is NOT cleared -- preserved for fallback on failure.

    await stream.start(() =>
      refineDesign(
        personaIdRef.current!,
        feedback,
        currentResultJson,
        clientDesignId,
        conversationIdRef.current,
      ),
    );
  }, [stream.start, designResult]);

  const answerQuestion = useCallback((answer: string) => {
    if (!personaIdRef.current) return;
    setQuestion(null);
    refineAnalysis(answer);
  }, [refineAnalysis]);

  const cancelAnalysis = useCallback(() => {
    cancelDesignAnalysis(designIdRef.current ?? undefined).catch(silentCatch("designAnalysis:cancel"));
    stream.cancel();
    designIdRef.current = null;
    setDesignPhase('idle');
    setQuestion(null);
  }, [stream.cancel]);

  // -- Apply result --------------------------------------------------

  const applyResultCb = useCallback(async (selections?: ApplyDesignSelections) => {
    if (!personaIdRef.current || !designResult || applyingRef.current) return;
    applyingRef.current = true;
    const personaId = personaIdRef.current;

    setDesignPhase('applying');
    try {
      const { warnings, failedOperations: failed } = await applyDesignResult(
        personaId,
        designResult,
        { applyPersonaOp, refreshPersonas },
        selections,
      );
      setApplyWarnings(warnings);
      setFailedOperations(failed);
      setDesignPhase('applied');
    } catch (err) {
      stream.setError(err instanceof Error ? err.message : 'Failed to apply design');
      setDesignPhase('preview');
    } finally {
      applyingRef.current = false;
    }
  }, [designResult, applyPersonaOp, refreshPersonas, stream.setError]);

  const retryFailedCb = useCallback(async () => {
    if (!personaIdRef.current || failedOperations.length === 0 || applyingRef.current) return;
    applyingRef.current = true;
    setDesignPhase('applying');
    try {
      const { warnings, failedOperations: stillFailed } = await retryFailedOperations(
        personaIdRef.current,
        failedOperations,
        { refreshPersonas },
      );
      setApplyWarnings(stillFailed.length > 0 ? warnings : []);
      setFailedOperations(stillFailed);
      setDesignPhase('applied');
    } catch (err) {
      stream.setError(err instanceof Error ? err.message : 'Retry failed');
      setDesignPhase('applied');
    } finally {
      applyingRef.current = false;
    }
  }, [failedOperations, refreshPersonas, stream.setError]);

  const setConversationId = useCallback((id: string | null) => {
    conversationIdRef.current = id;
  }, []);

  const reset = useCallback(() => {
    stream.reset();
    designIdRef.current = null;
    conversationIdRef.current = null;
    setDesignPhase('idle');
    setDesignResult(null);
    setApplyWarnings([]);
    setFailedOperations([]);
    setQuestion(null);
  }, [stream.reset]);

  return {
    phase: designPhase,
    outputLines,
    result: designResult,
    error: stream.error,
    applyWarnings,
    failedOperations,
    question,
    startAnalysis,
    startIntentCompilation,
    refineAnalysis,
    answerQuestion,
    cancelAnalysis,
    applyResult: applyResultCb,
    retryFailed: retryFailedCb,
    reset,
    setConversationId,
  };
}
