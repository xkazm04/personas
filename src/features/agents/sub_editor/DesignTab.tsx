import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaCompiler } from '@/hooks/design/usePersonaCompiler';
import { useDesignConversation } from '@/hooks/design/useDesignConversation';
import { useToggleSet } from '@/hooks/utility/useToggleSet';
import type { DesignAnalysisResult, IntentCompilationResult } from '@/lib/types/designTypes';
import { AnimatePresence } from 'framer-motion';
import { PhaseIndicator } from '@/features/agents/sub_editor/PhaseIndicator';
import { DesignPhasePanel } from '@/features/agents/sub_editor/DesignPhasePanel';
import { DesignQuestionPanel } from '@/features/agents/sub_editor/DesignQuestionPanel';
import { DesignPhaseAnalyzing } from '@/features/agents/sub_editor/DesignPhaseAnalyzing';
import { DesignPhaseRefining } from '@/features/agents/sub_editor/DesignPhaseRefining';
import { DesignPhasePreview } from '@/features/agents/sub_editor/DesignPhasePreview';
import { DesignPhaseApplying } from '@/features/agents/sub_editor/DesignPhaseApplying';
import { DesignPhaseApplied } from '@/features/agents/sub_editor/DesignPhaseApplied';
import { DesignConversationHistory } from '@/features/agents/sub_editor/DesignConversationHistory';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/UseCasesList';
import { applyDesignContextMutation } from '@/features/agents/sub_editor/use-cases/useCaseHelpers';
import { parseConversationMessages } from '@/lib/types/designTypes';

export function DesignTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const toolDefinitions = usePersonaStore((s) => s.toolDefinitions);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const autoStartDesignInstruction = usePersonaStore((s) => s.autoStartDesignInstruction);
  const setAutoStartDesignInstruction = usePersonaStore((s) => s.setAutoStartDesignInstruction);

  // Fetch connector definitions on mount
  useEffect(() => {
    if (connectorDefinitions.length === 0) {
      fetchConnectorDefinitions();
    }
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

  // Persistent conversation management
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

  // Track prev phase to detect transitions
  const prevPhaseRef = useRef(phase);

  const [instruction, setInstruction] = useState('');
  const [intentMode, setIntentMode] = useState(false);
  const [designContext, setDesignContext] = useState<DesignFilesSection>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();

  // Record conversation messages on phase transitions
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    // When a question arrives, record it in the conversation
    if (phase === 'awaiting-input' && question && prev !== 'awaiting-input') {
      addQuestionMessage(question);
    }

    // When a result arrives (preview phase), record it
    if (phase === 'preview' && result && prev !== 'preview') {
      addResultMessage(result);
    }

    // When an error occurs while transitioning back to idle/preview, record it
    if (error && (phase === 'idle' || phase === 'preview') && (prev === 'analyzing' || prev === 'refining')) {
      addErrorMessage(error);
    }
  }, [phase, question, result, error, addQuestionMessage, addResultMessage, addErrorMessage]);

  // Auto-start design analysis when coming from CreationWizard
  useEffect(() => {
    if (autoStartDesignInstruction && selectedPersona && phase === 'idle') {
      setInstruction(autoStartDesignInstruction);
      setAutoStartDesignInstruction(null);
      compile(selectedPersona.id, autoStartDesignInstruction);
    }
  }, [autoStartDesignInstruction, selectedPersona, phase, setAutoStartDesignInstruction, compile]);

  // Parse saved design result from persona DB
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

  // Initialize design files from persona DB (extract from typed envelope)
  useEffect(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    setDesignContext(ctx.designFiles ?? { files: [], references: [] });
  }, [selectedPersona?.id]);

  // Initialize selections when result arrives
  const resultId = result
    ? `${result.summary}-${result.suggested_tools.length}`
    : null;

  useEffect(() => {
    if (result) {
      setSelectedTools(new Set(result.suggested_tools));
      setSelectedTriggerIndices(
        new Set(result.suggested_triggers.map((_: unknown, i: number) => i))
      );
      setSelectedChannelIndices(
        new Set((result.suggested_notification_channels || []).map((_: unknown, i: number) => i))
      );
      if (result.suggested_event_subscriptions?.length) {
        setSelectedSubscriptionIndices(new Set(result.suggested_event_subscriptions.map((_: unknown, i: number) => i)));
      }
    }
  }, [resultId]);

  const currentToolNames = useMemo(
    () => (selectedPersona?.tools || []).map((t) => t.name),
    [selectedPersona]
  );

  const changeSummary = useMemo(() => {
    if (!result) return [];
    const items: string[] = [];

    // System prompt change
    if (result.full_prompt_markdown) {
      const hasExisting = !!selectedPersona?.system_prompt?.trim();
      items.push(hasExisting ? 'Update system prompt' : 'Set system prompt');
    }

    // Tools
    const selectedToolCount = selectedTools.size;
    if (selectedToolCount > 0) {
      const newTools = [...selectedTools].filter((t) => !currentToolNames.includes(t));
      if (newTools.length > 0 && newTools.length < selectedToolCount) {
        items.push(`Add ${newTools.length} new tool${newTools.length !== 1 ? 's' : ''}, keep ${selectedToolCount - newTools.length} existing`);
      } else if (newTools.length === selectedToolCount) {
        items.push(`Add ${selectedToolCount} tool${selectedToolCount !== 1 ? 's' : ''}`);
      } else {
        items.push(`Keep ${selectedToolCount} tool${selectedToolCount !== 1 ? 's' : ''}`);
      }
    }

    // Triggers
    const triggerCount = selectedTriggerIndices.size;
    if (triggerCount > 0) {
      items.push(`Add ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}`);
    }

    // Notification channels
    const channelCount = selectedChannelIndices.size;
    if (channelCount > 0) {
      items.push(`Add ${channelCount} notification channel${channelCount !== 1 ? 's' : ''}`);
    }

    // Event subscriptions
    const subCount = selectedSubscriptionIndices.size;
    if (subCount > 0) {
      items.push(`Add ${subCount} event subscription${subCount !== 1 ? 's' : ''}`);
    }

    return items;
  }, [result, selectedTools, selectedTriggerIndices, selectedChannelIndices, selectedSubscriptionIndices, currentToolNames, selectedPersona?.system_prompt]);

  const handleStartAnalysis = async () => {
    if (!selectedPersona || !instruction.trim()) return;

    if (intentMode) {
      // Intent compiler mode — skip design files and conversations
      compileIntent(selectedPersona.id, instruction.trim());
      return;
    }

    const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
    if (hasContext) {
      // Merge the design files into the existing envelope, preserving other sections
      await applyDesignContextMutation(selectedPersona.id, (ctx) => {
        const existing = parseDesignContext(ctx);
        return serializeDesignContext({ ...existing, designFiles: designContext });
      });
    }
    // Create a new design conversation for this session
    const conv = await startConversation(instruction.trim());
    const convId = conv?.id ?? null;
    setConversationId(convId);
    compile(selectedPersona.id, instruction.trim(), convId);
  };

  const handleApply = async () => {
    if (!selectedPersona || !result) return;
    await applyCompilation({
      selectedTools,
      selectedTriggerIndices,
      selectedChannelIndices,
      selectedSubscriptionIndices,
    });
    // Mark conversation as completed after successful apply
    await completeConversation();
  };

  const handleRefine = () => {
    reset();
  };

  const handleSendRefinement = () => {
    if (!selectedPersona || !refinementMessage.trim()) return;
    addUserMessage(refinementMessage.trim(), 'feedback');
    recompile(refinementMessage.trim());
    setRefinementMessage('');
  };

  const handleDiscard = () => {
    reset();
    clearActive();
    setInstruction('');
    setDesignContext({ files: [], references: [] });
  };

  const handleReset = () => {
    reset();
    clearActive();
    setInstruction('');
  };

  const handleResumeConversation = useCallback(async (conversation: typeof conversations[0]) => {
    const updated = await resumeConversation(conversation);
    if (!updated || !selectedPersona) return;

    // Parse messages to find the last instruction and set it
    const messages = parseConversationMessages(updated.messages);
    const lastInstruction = [...messages].reverse().find((m) => m.role === 'user' && m.messageType === 'instruction');
    if (lastInstruction) {
      setInstruction(lastInstruction.content);
    }

    // Link the conversation so refinements use its history
    setConversationId(updated.id);
  }, [resumeConversation, selectedPersona, setConversationId]);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} />

      {/* Conversation history — always visible in idle phase */}
      {phase === 'idle' && conversations.length > 0 && (
        <DesignConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          onResumeConversation={handleResumeConversation}
          onDeleteConversation={removeConversation}
        />
      )}

      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <DesignPhasePanel
            savedDesignResult={savedDesignResult}
            selectedPersona={selectedPersona}
            toolDefinitions={toolDefinitions}
            currentToolNames={currentToolNames}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            instruction={instruction}
            onInstructionChange={setInstruction}
            designContext={designContext}
            onDesignContextChange={setDesignContext}
            phase={phase}
            error={error}
            onStartAnalysis={handleStartAnalysis}
            intentMode={intentMode}
            onIntentModeChange={setIntentMode}
          />
        )}

        {phase === 'analyzing' && (
          <DesignPhaseAnalyzing
            instruction={instruction}
            outputLines={outputLines}
            savedDesignResult={savedDesignResult}
            onCancel={cancelAnalysis}
          />
        )}

        {phase === 'refining' && (
          <DesignPhaseRefining
            outputLines={outputLines}
            result={result}
            onCancel={cancelAnalysis}
          />
        )}

        {phase === 'awaiting-input' && question && (
          <DesignQuestionPanel
            outputLines={outputLines}
            question={question}
            onAnswerQuestion={(answer: string) => {
              addUserMessage(answer, 'answer');
              answerAndContinue(answer);
            }}
            onCancelAnalysis={cancelAnalysis}
          />
        )}

        {phase === 'preview' && result && (
          <DesignPhasePreview
            result={result}
            intentResult={intentMode ? (result as IntentCompilationResult) : undefined}
            error={error}
            toolDefinitions={toolDefinitions}
            currentToolNames={currentToolNames}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            selectedTools={selectedTools}
            selectedTriggerIndices={selectedTriggerIndices}
            selectedChannelIndices={selectedChannelIndices}
            selectedSubscriptionIndices={selectedSubscriptionIndices}
            onToolToggle={handleToolToggle}
            onTriggerToggle={handleTriggerToggle}
            onChannelToggle={handleChannelToggle}
            onSubscriptionToggle={handleSubscriptionToggle}
            changeSummary={changeSummary}
            refinementMessage={refinementMessage}
            onRefinementMessageChange={setRefinementMessage}
            onApply={handleApply}
            onRefine={handleRefine}
            onDiscard={handleDiscard}
            onSendRefinement={handleSendRefinement}
          />
        )}

        {phase === 'applying' && <DesignPhaseApplying />}

        {phase === 'applied' && (
          <DesignPhaseApplied result={result} warnings={applyWarnings} onReset={handleReset} />
        )}
      </AnimatePresence>
    </div>
  );
}
