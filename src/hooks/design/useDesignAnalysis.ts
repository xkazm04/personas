import { useState, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { startDesignAnalysis, refineDesign, cancelDesignAnalysis } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';
import type { DesignPhase, DesignAnalysisResult, DesignQuestion } from '@/lib/types/designTypes';

interface DesignOutputPayload {
  design_id: string;
  line: string;
}

interface DesignStatusPayload {
  design_id: string;
  status: string;
  result?: DesignAnalysisResult;
  error?: string;
  question?: DesignQuestion;
}

export function useDesignAnalysis() {
  const [phase, setPhase] = useState<DesignPhase>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [result, setResult] = useState<DesignAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<DesignQuestion | null>(null);
  const personaIdRef = useRef<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const updatePersona = usePersonaStore((s) => s.updatePersona);
  const refreshPersonas = usePersonaStore((s) => s.fetchPersonas);

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const setupDesignListeners = useCallback(async (
    failureMessage: string,
    failurePhase: DesignPhase,
  ) => {
    const unlistenOutput = await listen<DesignOutputPayload>('design-output', (event) => {
      setOutputLines((prev) => [...prev, event.payload.line]);
    });

    const unlistenStatus = await listen<DesignStatusPayload>('design-status', (event) => {
      const { status, result: designResult, error: designError, question: designQuestion } = event.payload;

      if (status === 'awaiting-input' && designQuestion) {
        setQuestion(designQuestion);
        setPhase('awaiting-input');
        cleanup();
      } else if (status === 'completed' && designResult) {
        setResult(designResult);
        setPhase('preview');
        cleanup();
      } else if (status === 'failed') {
        setError(designError || failureMessage);
        setPhase(failurePhase);
        cleanup();
      }
    });

    unlistenersRef.current = [unlistenOutput, unlistenStatus];
  }, [cleanup]);

  const startAnalysis = useCallback(async (personaId: string, instruction: string) => {
    cleanup();
    setPhase('analyzing');
    setOutputLines([]);
    setResult(null);
    setError(null);
    setQuestion(null);
    personaIdRef.current = personaId;

    try {
      await setupDesignListeners('Design analysis failed', 'idle');
      await startDesignAnalysis(instruction, personaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
      setPhase('idle');
      cleanup();
    }
  }, [cleanup, setupDesignListeners]);

  const refineAnalysis = useCallback(async (feedback: string) => {
    if (!personaIdRef.current) return;

    cleanup();
    setPhase('refining');
    setOutputLines([]);
    setError(null);
    setQuestion(null);

    try {
      await setupDesignListeners('Refinement failed', 'preview');
      await refineDesign(personaIdRef.current, feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refine design');
      setPhase('preview');
      cleanup();
    }
  }, [cleanup, setupDesignListeners]);

  const answerQuestion = useCallback((answer: string) => {
    if (!personaIdRef.current) return;
    // Clear the question and continue analysis — the answer is sent as
    // a refinement message which re-runs the CLI with the answer context.
    setQuestion(null);
    refineAnalysis(answer);
  }, [refineAnalysis]);

  const cancelAnalysis = useCallback(() => {
    cancelDesignAnalysis().catch(() => {});
    cleanup();
    setPhase('idle');
    setOutputLines([]);
    setError(null);
    setQuestion(null);
  }, [cleanup]);

  const applyResult = useCallback(async (selections?: {
    selectedTools?: Set<string>;
    selectedTriggerIndices?: Set<number>;
    selectedChannelIndices?: Set<number>;
    selectedSubscriptionIndices?: Set<number>;
  }) => {
    if (!personaIdRef.current || !result) return;

    setPhase('applying');
    try {
      // Filter result through user selections before saving
      const filteredResult: DesignAnalysisResult = {
        ...result,
        suggested_tools: selections?.selectedTools
          ? result.suggested_tools.filter((t) => selections.selectedTools!.has(t))
          : result.suggested_tools,
        suggested_triggers: selections?.selectedTriggerIndices
          ? result.suggested_triggers.filter((_, i) => selections.selectedTriggerIndices!.has(i))
          : result.suggested_triggers,
        suggested_notification_channels: selections?.selectedChannelIndices
          ? (result.suggested_notification_channels ?? []).filter((_, i) => selections.selectedChannelIndices!.has(i))
          : result.suggested_notification_channels,
        suggested_event_subscriptions: selections?.selectedSubscriptionIndices
          ? (result.suggested_event_subscriptions ?? []).filter((_, i) => selections.selectedSubscriptionIndices!.has(i))
          : result.suggested_event_subscriptions,
      };

      // Update persona with the filtered design result
      const updates: Record<string, unknown> = {
        last_design_result: JSON.stringify(filteredResult),
      };

      // Apply structured prompt if present
      if (filteredResult.structured_prompt) {
        updates.structured_prompt = JSON.stringify(filteredResult.structured_prompt);
      }

      // Apply full prompt as system_prompt
      if (filteredResult.full_prompt_markdown) {
        updates.system_prompt = filteredResult.full_prompt_markdown;
      }

      await updatePersona(personaIdRef.current, updates);
      await refreshPersonas();
      setPhase('applied');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply design');
      setPhase('preview');
    }
  }, [result, updatePersona, refreshPersonas]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setOutputLines([]);
    setResult(null);
    setError(null);
    setQuestion(null);
  }, [cleanup]);

  return {
    phase,
    outputLines,
    result,
    error,
    question,
    startAnalysis,
    refineAnalysis,
    answerQuestion,
    cancelAnalysis,
    applyResult,
    reset,
  };
}
