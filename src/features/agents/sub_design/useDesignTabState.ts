import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { usePersonaCompiler } from '@/hooks/design/core/usePersonaCompiler';
import { useDesignConversation } from '@/hooks/design/core/useDesignConversation';
import { useToggleSet } from '@/hooks/utility/interaction/useToggleSet';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { useParsedDesignContext } from '@/stores/selectors/personaSelectors';
import { mutateDesignFiles } from '@/hooks/design/core/useDesignContextMutator';
import { parseConversationMessages } from '@/lib/types/designTypes';
import { allIndices, buildChangeSummary } from './DesignTabHelpers';
import type { ExamplePair } from './wizard/ExamplePairCollector';
import { formatExamplePairsAsIntent } from './wizard/ExamplePairCollector';

export type DesignInputMode = 'design' | 'intent' | 'example';

export function useDesignTabState() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const toolDefinitions = useAgentStore((s) => s.toolDefinitions);
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);
  const autoStartDesignInstruction = useSystemStore((s) => s.autoStartDesignInstruction);
  const setAutoStartDesignInstruction = useSystemStore((s) => s.setAutoStartDesignInstruction);
  const allDriftEvents = useAgentStore((s) => s.designDriftEvents);
  const dismissDriftEvent = useAgentStore((s) => s.dismissDriftEvent);

  useEffect(() => {
    if (connectorDefinitions.length === 0) fetchConnectorDefinitions();
  }, [connectorDefinitions.length, fetchConnectorDefinitions]);

  const {
    phase,
    outputLines,
    result,
    error,
    applyWarnings,
    failedOperations,
    question,
    compile,
    compileIntent,
    cancel: cancelAnalysis,
    recompile,
    answerAndContinue,
    applyCompilation,
    retryFailed,
    reset,
    setConversationId,
  } = usePersonaCompiler();

  const prevPersonaIdRef = useRef<string | null>(null);

  const {
    conversations,
    activeConversationId,
    startConversation,
    addUserMessage,
    addQuestionMessage,
    addResultMessage,
    addErrorMessage,
    completeConversation,
    resumeConversation,
    removeConversation,
    clearActive,
  } = useDesignConversation(selectedPersona?.id ?? null);

  const prevPhaseRef = useRef(phase);
  const [instruction, setInstruction] = useState('');
  const [inputMode, setInputMode] = useState<DesignInputMode>('design');
  const intentMode = inputMode === 'intent';
  const [examplePairs, setExamplePairs] = useState<ExamplePair[]>([]);
  const [designContext, setDesignContext] = useState<DesignFilesSection>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();

  const clearSelections = useCallback(() => {
    setSelectedTools(new Set());
    setSelectedTriggerIndices(new Set());
    setSelectedChannelIndices(new Set());
    setSelectedSubscriptionIndices(new Set());
  }, [setSelectedTools, setSelectedTriggerIndices, setSelectedChannelIndices, setSelectedSubscriptionIndices]);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === 'awaiting-input' && question && prev !== 'awaiting-input') {
      addQuestionMessage(question);
    }
    if (phase === 'preview' && result && prev !== 'preview') {
      addResultMessage(result);
    }
    if (error && (phase === 'idle' || phase === 'preview' || phase === 'error') && (prev === 'analyzing' || prev === 'refining')) {
      addErrorMessage(error);
    }
  }, [phase, question, result, error, addQuestionMessage, addResultMessage, addErrorMessage]);

  useEffect(() => {
    if (!autoStartDesignInstruction || !selectedPersona || phase !== 'idle') return;

    const instructionText = autoStartDesignInstruction.trim();
    if (!instructionText) {
      setAutoStartDesignInstruction(null);
      return;
    }

    let cancelled = false;
    const startAutoDesign = async () => {
      setInstruction(instructionText);
      setAutoStartDesignInstruction(null);

      const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
      if (hasContext) {
        await mutateDesignFiles(selectedPersona.id, () => designContext);
      }

      const conv = await startConversation(instructionText);
      if (cancelled) return;
      const convId = conv?.id ?? null;
      setConversationId(convId);
      compile(selectedPersona.id, instructionText, convId);
    };

    void startAutoDesign();
    return () => {
      cancelled = true;
    };
  }, [
    autoStartDesignInstruction,
    selectedPersona,
    phase,
    setAutoStartDesignInstruction,
    designContext,
    startConversation,
    setConversationId,
    compile,
  ]);

  const savedDesignResult = useMemo<DesignAnalysisResult | null>(() => {
    const parsed = parseJsonOrDefault<DesignAnalysisResult | null>(selectedPersona?.last_design_result, null);
    if (!parsed) return null;
    const GOOGLE_CONNECTORS = new Set(['gmail', 'google_calendar', 'google_drive']);
    if (parsed.suggested_connectors) {
      return {
        ...parsed,
        suggested_connectors: parsed.suggested_connectors.map((c) =>
          !c.oauth_type && GOOGLE_CONNECTORS.has(c.name)
            ? { ...c, oauth_type: 'google' as const }
            : c
        ),
      };
    }
    return parsed;
  }, [selectedPersona?.last_design_result]);

  const parsedDesignCtx = useParsedDesignContext();
  useEffect(() => {
    setDesignContext(parsedDesignCtx.designFiles ?? { files: [], references: [] });
  }, [selectedPersona?.id]);

  useEffect(() => {
    const currentPersonaId = selectedPersona?.id ?? null;
    if (prevPersonaIdRef.current === null) {
      prevPersonaIdRef.current = currentPersonaId;
      return;
    }
    if (prevPersonaIdRef.current !== currentPersonaId) {
      reset();
      clearActive();
      clearSelections();
      setInstruction('');
      setInputMode('design');
      setExamplePairs([]);
      setRefinementMessage('');
    }
    prevPersonaIdRef.current = currentPersonaId;
  }, [selectedPersona?.id, reset, clearActive]);

  const resultId = result ? `${result.summary}-${result.suggested_tools.length}` : null;
  useEffect(() => {
    if (result) {
      setSelectedTools(new Set(result.suggested_tools));
      setSelectedTriggerIndices(allIndices(result.suggested_triggers));
      setSelectedChannelIndices(allIndices(result.suggested_notification_channels));
      if (result.suggested_event_subscriptions?.length) {
        setSelectedSubscriptionIndices(allIndices(result.suggested_event_subscriptions));
      }
    }
  }, [resultId]);
  const currentToolNames = useMemo(
    () => (selectedPersona?.tools || []).map((t) => t.name),
    [selectedPersona]
  );
  const changeSummary = useMemo(
    () => buildChangeSummary({
      result, selectedTools, selectedTriggerIndices, selectedChannelIndices,
      selectedSubscriptionIndices, currentToolNames, selectedPersona,
    }),
    [result, selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices, currentToolNames, selectedPersona]
  );

  const handleStartAnalysis = useCallback(async () => {
    if (!selectedPersona) return;

    // Example mode: format pairs into structured intent
    if (inputMode === 'example') {
      const validPairs = examplePairs.filter((p) => p.input.trim() || p.output.trim());
      if (validPairs.length === 0) return;
      const intent = formatExamplePairsAsIntent(examplePairs, instruction.trim() || undefined);
      compileIntent(selectedPersona.id, intent);
      return;
    }

    if (!instruction.trim()) return;
    if (intentMode) {
      compileIntent(selectedPersona.id, instruction.trim());
      return;
    }
    const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
    if (hasContext) {
      await mutateDesignFiles(selectedPersona.id, () => designContext);
    }
    const conv = await startConversation(instruction.trim());
    const convId = conv?.id ?? null;
    setConversationId(convId);
    compile(selectedPersona.id, instruction.trim(), convId);
  }, [selectedPersona, instruction, inputMode, intentMode, examplePairs, designContext, compileIntent, startConversation, setConversationId, compile]);

  const handleApply = useCallback(async () => {
    if (!selectedPersona || !result) return;
    await applyCompilation({ selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices });
    await completeConversation();
  }, [selectedPersona, result, applyCompilation, selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices, completeConversation]);

  const handleRefine = useCallback(() => { reset(); clearSelections(); }, [reset, clearSelections]);

  const handleSendRefinement = useCallback(() => {
    if (!selectedPersona || !refinementMessage.trim()) return;
    addUserMessage(refinementMessage.trim(), 'feedback');
    recompile(refinementMessage.trim());
    setRefinementMessage('');
  }, [selectedPersona, refinementMessage, addUserMessage, recompile]);

  const handleDiscard = useCallback(() => {
    reset(); clearActive(); clearSelections(); setInstruction('');
    setInputMode('design');
    setExamplePairs([]);
    setDesignContext({ files: [], references: [] });
  }, [reset, clearActive, clearSelections]);

  const handleReset = useCallback(() => {
    reset(); clearActive(); clearSelections(); setInstruction('');
    setInputMode('design');
    setExamplePairs([]);
  }, [reset, clearActive, clearSelections]);

  const handleAnswerQuestion = useCallback((answer: string) => {
    addUserMessage(answer, 'answer');
    answerAndContinue(answer);
  }, [addUserMessage, answerAndContinue]);

  const handleResumeConversation = useCallback(async (conversation: typeof conversations[0]) => {
    const updated = await resumeConversation(conversation);
    if (!updated || !selectedPersona) return;
    const messages = parseConversationMessages(updated.messages) ?? [];
    const lastInstruction = [...messages].reverse().find((m) => m.role === 'user' && m.messageType === 'instruction');
    if (lastInstruction) setInstruction(lastInstruction.content);
    setConversationId(updated.id);
  }, [resumeConversation, selectedPersona, setConversationId]);

  // Filter drift events for the current persona
  const driftEvents = useMemo(
    () => allDriftEvents.filter((e) => e.personaId === selectedPersona?.id),
    [allDriftEvents, selectedPersona?.id],
  );

  return {
    selectedPersona, toolDefinitions, credentials, connectorDefinitions,
    phase, outputLines, result, error, applyWarnings, failedOperations, question, retryFailed,
    cancelAnalysis, conversations, activeConversationId, removeConversation,
    instruction, setInstruction, intentMode,
    inputMode, setInputMode, examplePairs, setExamplePairs,
    designContext, setDesignContext, refinementMessage, setRefinementMessage,
    selectedTools, handleToolToggle, selectedTriggerIndices, handleTriggerToggle,
    selectedChannelIndices, handleChannelToggle, selectedSubscriptionIndices, handleSubscriptionToggle,
    savedDesignResult, currentToolNames, changeSummary,
    handleStartAnalysis, handleApply, handleRefine, handleSendRefinement,
    handleDiscard, handleReset, handleAnswerQuestion, handleResumeConversation,
    driftEvents, dismissDriftEvent,
  };
}
