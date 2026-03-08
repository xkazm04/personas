import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaCompiler } from '@/hooks/design/usePersonaCompiler';
import { useDesignConversation } from '@/hooks/design/useDesignConversation';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import { mutateDesignFiles } from '@/hooks/design/useDesignContextMutator';
import { parseConversationMessages } from '@/lib/types/designTypes';
import type { ExamplePair } from '../ExamplePairCollector';
import { formatExamplePairsAsIntent } from '../ExamplePairCollector';
import {
  useSavedDesignResult, useDesignContextSync, useSelectionState,
  useResultSelectionSync, useChangeSummary, useDriftEventsForPersona,
} from './designStateHelpers';

export type DesignInputMode = 'design' | 'intent' | 'example';

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
    phase, outputLines, result, error, applyWarnings, failedOperations,
    question, compile, compileIntent, cancel: cancelAnalysis, recompile,
    answerAndContinue, applyCompilation, retryFailed, reset, setConversationId,
  } = usePersonaCompiler();

  const prevPersonaIdRef = useRef<string | null>(null);
  const {
    conversations, activeConversationId, startConversation, addUserMessage,
    addQuestionMessage, addResultMessage, addErrorMessage,
    completeConversation, resumeConversation, removeConversation, clearActive,
  } = useDesignConversation(selectedPersona?.id ?? null);

  const prevPhaseRef = useRef(phase);
  const [instruction, setInstruction] = useState('');
  const [inputMode, setInputMode] = useState<DesignInputMode>('design');
  const intentMode = inputMode === 'intent';
  const [examplePairs, setExamplePairs] = useState<ExamplePair[]>([]);
  const [designContext, setDesignContext] = useState<DesignFilesSection>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');

  const selections = useSelectionState();
  const { clearSelections } = selections;

  // Sync conversation messages with phase transitions
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === 'awaiting-input' && question && prev !== 'awaiting-input') addQuestionMessage(question);
    if (phase === 'preview' && result && prev !== 'preview') addResultMessage(result);
    if (error && (phase === 'idle' || phase === 'preview' || phase === 'error') && (prev === 'analyzing' || prev === 'refining')) addErrorMessage(error);
  }, [phase, question, result, error, addQuestionMessage, addResultMessage, addErrorMessage]);

  // Auto-start design from external instruction
  useEffect(() => {
    if (!autoStartDesignInstruction || !selectedPersona || phase !== 'idle') return;
    const instructionText = autoStartDesignInstruction.trim();
    if (!instructionText) { setAutoStartDesignInstruction(null); return; }
    let cancelled = false;
    const startAutoDesign = async () => {
      setInstruction(instructionText);
      setAutoStartDesignInstruction(null);
      const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
      if (hasContext) await mutateDesignFiles(selectedPersona.id, () => designContext);
      const conv = await startConversation(instructionText);
      if (cancelled) return;
      const convId = conv?.id ?? null;
      setConversationId(convId);
      compile(selectedPersona.id, instructionText, convId);
    };
    void startAutoDesign();
    return () => { cancelled = true; };
  }, [autoStartDesignInstruction, selectedPersona, phase, setAutoStartDesignInstruction, designContext, startConversation, setConversationId, compile]);

  const savedDesignResult = useSavedDesignResult(selectedPersona);
  useDesignContextSync(selectedPersona, setDesignContext);
  useResultSelectionSync(result, selections.setSelectedTools, selections.setSelectedTriggerIndices, selections.setSelectedChannelIndices, selections.setSelectedSubscriptionIndices);
  const { currentToolNames, changeSummary } = useChangeSummary(result, selections.selectedTools, selections.selectedTriggerIndices, selections.selectedChannelIndices, selections.selectedSubscriptionIndices, selectedPersona);
  const { driftEvents, dismissDriftEvent } = useDriftEventsForPersona(selectedPersona?.id);

  // Reset on persona switch
  useEffect(() => {
    const currentPersonaId = selectedPersona?.id ?? null;
    if (prevPersonaIdRef.current === null) { prevPersonaIdRef.current = currentPersonaId; return; }
    if (prevPersonaIdRef.current !== currentPersonaId) {
      reset(); clearActive(); clearSelections(); setInstruction(''); setInputMode('design'); setExamplePairs([]); setRefinementMessage('');
    }
    prevPersonaIdRef.current = currentPersonaId;
  }, [selectedPersona?.id, reset, clearActive]);

  const handleStartAnalysis = useCallback(async () => {
    if (!selectedPersona) return;
    if (inputMode === 'example') {
      const validPairs = examplePairs.filter((p) => p.input.trim() || p.output.trim());
      if (validPairs.length === 0) return;
      compileIntent(selectedPersona.id, formatExamplePairsAsIntent(examplePairs, instruction.trim() || undefined));
      return;
    }
    if (!instruction.trim()) return;
    if (intentMode) { compileIntent(selectedPersona.id, instruction.trim()); return; }
    const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
    if (hasContext) await mutateDesignFiles(selectedPersona.id, () => designContext);
    const conv = await startConversation(instruction.trim());
    const convId = conv?.id ?? null;
    setConversationId(convId);
    compile(selectedPersona.id, instruction.trim(), convId);
  }, [selectedPersona, instruction, inputMode, intentMode, examplePairs, designContext, compileIntent, startConversation, setConversationId, compile]);

  const handleApply = useCallback(async () => {
    if (!selectedPersona || !result) return;
    await applyCompilation({ selectedTools: selections.selectedTools, selectedTriggerIndices: selections.selectedTriggerIndices, selectedChannelIndices: selections.selectedChannelIndices, selectedSubscriptionIndices: selections.selectedSubscriptionIndices });
    await completeConversation();
  }, [selectedPersona, result, applyCompilation, selections.selectedTools, selections.selectedTriggerIndices, selections.selectedChannelIndices, selections.selectedSubscriptionIndices, completeConversation]);

  const handleRefine = useCallback(() => { reset(); clearSelections(); }, [reset, clearSelections]);
  const handleSendRefinement = useCallback(() => {
    if (!selectedPersona || !refinementMessage.trim()) return;
    addUserMessage(refinementMessage.trim(), 'feedback'); recompile(refinementMessage.trim()); setRefinementMessage('');
  }, [selectedPersona, refinementMessage, addUserMessage, recompile]);

  const handleDiscard = useCallback(() => {
    reset(); clearActive(); clearSelections(); setInstruction(''); setInputMode('design'); setExamplePairs([]); setDesignContext({ files: [], references: [] });
  }, [reset, clearActive, clearSelections]);

  const handleReset = useCallback(() => {
    reset(); clearActive(); clearSelections(); setInstruction(''); setInputMode('design'); setExamplePairs([]);
  }, [reset, clearActive, clearSelections]);

  const handleAnswerQuestion = useCallback((answer: string) => {
    addUserMessage(answer, 'answer'); answerAndContinue(answer);
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
    phase, outputLines, result, error, applyWarnings, failedOperations, question, retryFailed,
    cancelAnalysis, conversations, activeConversationId, removeConversation,
    instruction, setInstruction, intentMode,
    inputMode, setInputMode, examplePairs, setExamplePairs,
    designContext, setDesignContext, refinementMessage, setRefinementMessage,
    selectedTools: selections.selectedTools, handleToolToggle: selections.handleToolToggle,
    selectedTriggerIndices: selections.selectedTriggerIndices, handleTriggerToggle: selections.handleTriggerToggle,
    selectedChannelIndices: selections.selectedChannelIndices, handleChannelToggle: selections.handleChannelToggle,
    selectedSubscriptionIndices: selections.selectedSubscriptionIndices, handleSubscriptionToggle: selections.handleSubscriptionToggle,
    savedDesignResult, currentToolNames, changeSummary,
    handleStartAnalysis, handleApply, handleRefine, handleSendRefinement,
    handleDiscard, handleReset, handleAnswerQuestion, handleResumeConversation,
    driftEvents, dismissDriftEvent,
  };
}
