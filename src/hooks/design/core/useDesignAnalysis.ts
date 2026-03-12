import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { startDesignAnalysis, refineDesign, cancelDesignAnalysis, compileFromIntent } from '@/api/templates/design';
import { usePersonaStore } from '@/stores/personaStore';
import { useTauriStream } from './useTauriStream';
import { applyDesignResult, retryFailedOperations, type ApplyDesignSelections, type FailedOperation } from '../credential/applyDesignResult';
import type { DesignPhase, AgentIR, DesignQuestion } from '@/lib/types/designTypes';

// -- Stream outcome discriminator ------------------------------------
// The design status event produces three outcomes (result, question, error).
// useTauriStream natively handles result + error; we encode questions as
// a result variant and route them in a useEffect.

type DesignStreamOutcome =
  | { kind: 'result'; data: AgentIR }
  | { kind: 'question'; data: DesignQuestion };

const MAX_OUTPUT_LINES = 500;

// -- Stable stream option callbacks ----------------------------------
// Defined outside the hook so they don't recreate on every render.
// They reference `designIdRef` which is a ref -- always current.

let _designIdRef: React.RefObject<string | null>;

function getLine(payload: Record<string, unknown>): string {
  if (_designIdRef.current && payload.design_id !== _designIdRef.current) return '';
  return payload.line as string;
}

function resolveStatus(payload: Record<string, unknown>):
  | { result: DesignStreamOutcome }
  | { error: string }
  | null {
  if (_designIdRef.current && payload.design_id !== _designIdRef.current) return null;
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
}

// -- Hook ------------------------------------------------------------

export function useDesignAnalysis() {
  // Design-specific state (layered on top of the generic stream)
  const [designResult, setDesignResult] = useState<AgentIR | null>(null);
  const [designPhase, setDesignPhase] = useState<DesignPhase>('idle');
  const [question, setQuestion] = useState<DesignQuestion | null>(null);
  const [applyWarnings, setApplyWarnings] = useState<string[]>([]);
  const [failedOperations, setFailedOperations] = useState<FailedOperation[]>([]);

  const personaIdRef = useRef<string | null>(null);
  const designIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const applyingRef = useRef(false);

  // Share the ref with the module-level callbacks
  _designIdRef = designIdRef;

  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const refreshPersonas = usePersonaStore((s) => s.fetchPersonas);

  // -- Core streaming via useTauriStream -----------------------------
  // Handles: listener lifecycle, line accumulation, cleanup on unmount,
  // timeout, and basic phase + error management.
  const stream = useTauriStream<DesignStreamOutcome>({
    progressEvent: 'design-output',
    statusEvent: 'design-status',
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

    await stream.start(() => startDesignAnalysis(instruction, personaId, clientDesignId));
    // If start() failed internally, stream.error is set and the error effect
    // routes designPhase to 'error'.
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
    const currentResultJson = designResult ? JSON.stringify(designResult) : null;
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
    cancelDesignAnalysis().catch(() => {});
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
