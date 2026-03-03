import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaCompiler } from '@/hooks/design/usePersonaCompiler';
import { useDesignConversation } from '@/hooks/design/useDesignConversation';
import { useToggleSet } from '@/hooks/utility/useToggleSet';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/UseCasesList';
import { applyDesignContextMutation } from '@/features/agents/sub_use_cases/useCaseHelpers';
import { parseConversationMessages } from '@/lib/types/designTypes';
import { buildChangeSummary } from './DesignTabHelpers';

export function useDesignTabState() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const toolDefinitions = usePersonaStore((s) => s.toolDefinitions);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const autoStartDesignInstruction = usePersonaStore((s) => s.autoStartDesignInstruction);
  const setAutoStartDesignInstruction = usePersonaStore((s) => s.setAutoStartDesignInstruction);

  useEffect(() => {
    if (connectorDefinitions.length === 0) fetchConnectorDefinitions();
  }, [connectorDefinitions.length, fetchConnectorDefinitions]);

  const {
    phase,
    outputLines,
    result,
    error,
    applyWarnings,
    question,
    compile,
    compileIntent,
    cancel: cancelAnalysis,
    recompile,
    answerAndContinue,
    applyCompilation,
    reset,
    setConversationId,
  } = usePersonaCompiler();

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
  const [intentMode, setIntentMode] = useState(false);
  const [designContext, setDesignContext] = useState<DesignFilesSection>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === 'awaiting-input' && question && prev !== 'awaiting-input') {
      addQuestionMessage(question);
    }
    if (phase === 'preview' && result && prev !== 'preview') {
      addResultMessage(result);
    }
    if (error && (phase === 'idle' || phase === 'preview') && (prev === 'analyzing' || prev === 'refining')) {
      addErrorMessage(error);
    }
  }, [phase, question, result, error, addQuestionMessage, addResultMessage, addErrorMessage]);

  useEffect(() => {
    if (autoStartDesignInstruction && selectedPersona && phase === 'idle') {
      setInstruction(autoStartDesignInstruction);
      setAutoStartDesignInstruction(null);
      compile(selectedPersona.id, autoStartDesignInstruction);
    }
  }, [autoStartDesignInstruction, selectedPersona, phase, setAutoStartDesignInstruction, compile]);

  const savedDesignResult = useMemo<DesignAnalysisResult | null>(() => {
    const parsed = parseJsonOrDefault<DesignAnalysisResult | null>(selectedPersona?.last_design_result, null);
    if (!parsed) return null;
    const GOOGLE_CONNECTORS = new Set(['gmail', 'google_calendar', 'google_drive']);
    parsed.suggested_connectors?.forEach((c) => {
      if (!c.oauth_type && GOOGLE_CONNECTORS.has(c.name)) {
        c.oauth_type = 'google';
      }
    });
    return parsed;
  }, [selectedPersona?.last_design_result]);

  useEffect(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    setDesignContext(ctx.designFiles ?? { files: [], references: [] });
  }, [selectedPersona?.id]);

  const resultId = result ? `${result.summary}-${result.suggested_tools.length}` : null;
  useEffect(() => {
    if (result) {
      setSelectedTools(new Set(result.suggested_tools));
      setSelectedTriggerIndices(new Set(result.suggested_triggers.map((_: unknown, i: number) => i)));
      setSelectedChannelIndices(new Set((result.suggested_notification_channels || []).map((_: unknown, i: number) => i)));
      if (result.suggested_event_subscriptions?.length) {
        setSelectedSubscriptionIndices(new Set(result.suggested_event_subscriptions.map((_: unknown, i: number) => i)));
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
    if (!selectedPersona || !instruction.trim()) return;
    if (intentMode) {
      compileIntent(selectedPersona.id, instruction.trim());
      return;
    }
    const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
    if (hasContext) {
      await applyDesignContextMutation(selectedPersona.id, (ctx) => {
        const existing = parseDesignContext(ctx);
        return serializeDesignContext({ ...existing, designFiles: designContext });
      });
    }
    const conv = await startConversation(instruction.trim());
    const convId = conv?.id ?? null;
    setConversationId(convId);
    compile(selectedPersona.id, instruction.trim(), convId);
  }, [selectedPersona, instruction, intentMode, designContext, compileIntent, startConversation, setConversationId, compile]);

  const handleApply = useCallback(async () => {
    if (!selectedPersona || !result) return;
    await applyCompilation({ selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices });
    await completeConversation();
  }, [selectedPersona, result, applyCompilation, selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices, completeConversation]);

  const handleRefine = useCallback(() => { reset(); }, [reset]);

  const handleSendRefinement = useCallback(() => {
    if (!selectedPersona || !refinementMessage.trim()) return;
    addUserMessage(refinementMessage.trim(), 'feedback');
    recompile(refinementMessage.trim());
    setRefinementMessage('');
  }, [selectedPersona, refinementMessage, addUserMessage, recompile]);

  const handleDiscard = useCallback(() => {
    reset(); clearActive(); setInstruction('');
    setIntentMode(false);
    setDesignContext({ files: [], references: [] });
  }, [reset, clearActive]);

  const handleReset = useCallback(() => {
    reset(); clearActive(); setInstruction('');
    setIntentMode(false);
  }, [reset, clearActive]);

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

  return {
    selectedPersona, toolDefinitions, credentials, connectorDefinitions,
    phase, outputLines, result, error, applyWarnings, question,
    cancelAnalysis, conversations, activeConversationId, removeConversation,
    instruction, setInstruction, intentMode, setIntentMode,
    designContext, setDesignContext, refinementMessage, setRefinementMessage,
    selectedTools, handleToolToggle, selectedTriggerIndices, handleTriggerToggle,
    selectedChannelIndices, handleChannelToggle, selectedSubscriptionIndices, handleSubscriptionToggle,
    savedDesignResult, currentToolNames, changeSummary,
    handleStartAnalysis, handleApply, handleRefine, handleSendRefinement,
    handleDiscard, handleReset, handleAnswerQuestion, handleResumeConversation,
  };
}
