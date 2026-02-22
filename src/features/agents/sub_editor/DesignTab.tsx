import { useState, useMemo, useEffect } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useDesignAnalysis } from '@/hooks/design/useDesignAnalysis';
import { useToggleSet } from '@/hooks/utility/useToggleSet';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { AnimatePresence } from 'framer-motion';
import { PhaseIndicator } from '@/features/agents/sub_editor/PhaseIndicator';
import { DesignPhasePanel } from '@/features/agents/sub_editor/DesignPhasePanel';
import { DesignQuestionPanel } from '@/features/agents/sub_editor/DesignQuestionPanel';
import { DesignPhaseAnalyzing } from '@/features/agents/sub_editor/DesignPhaseAnalyzing';
import { DesignPhaseRefining } from '@/features/agents/sub_editor/DesignPhaseRefining';
import { DesignPhasePreview } from '@/features/agents/sub_editor/DesignPhasePreview';
import { DesignPhaseApplying } from '@/features/agents/sub_editor/DesignPhaseApplying';
import { DesignPhaseApplied } from '@/features/agents/sub_editor/DesignPhaseApplied';
import type { DesignContext } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

type DesignMode = 'guided' | 'manual';

export function DesignTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const toolDefinitions = usePersonaStore((s) => s.toolDefinitions);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const updatePersona = usePersonaStore((s) => s.updatePersona);

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
    question,
    startAnalysis,
    cancelAnalysis,
    refineAnalysis,
    answerQuestion,
    applyResult,
    reset,
  } = useDesignAnalysis();

  const [instruction, setInstruction] = useState('');
  const [designContext, setDesignContext] = useState<DesignContext>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');
  const [designMode, setDesignMode] = useState<DesignMode>('guided');
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();


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

  // Initialize design context from persona DB
  useEffect(() => {
    setDesignContext(parseJsonOrDefault<DesignContext>(selectedPersona?.design_context, { files: [], references: [] }));
  }, [selectedPersona?.id]);

  // Initialize selections when result arrives
  const resultId = result
    ? `${result.summary}-${result.suggested_tools.length}`
    : null;

  useMemo(() => {
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
    const hasContext = designContext.files.length > 0 || designContext.references.length > 0;
    if (hasContext) {
      await updatePersona(selectedPersona.id, {
        design_context: JSON.stringify(designContext),
      });
    }
    startAnalysis(selectedPersona.id, instruction.trim());
  };

  const handleApply = async () => {
    if (!selectedPersona || !result) return;
    await applyResult({
      selectedTools,
      selectedTriggerIndices,
      selectedChannelIndices,
      selectedSubscriptionIndices,
    });
  };

  const handleRefine = () => {
    reset();
  };

  const handleSendRefinement = () => {
    if (!selectedPersona || !refinementMessage.trim()) return;
    refineAnalysis(refinementMessage.trim());
    setRefinementMessage('');
  };

  const handleDiscard = () => {
    reset();
    setInstruction('');
    setDesignContext({ files: [], references: [] });
  };

  const handleReset = () => {
    reset();
    setInstruction('');
  };

  const handleWizardComplete = (compiledInstruction: string) => {
    setInstruction(compiledInstruction);
    if (!selectedPersona) return;
    startAnalysis(selectedPersona.id, compiledInstruction);
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
        No persona selected
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} />
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
            designMode={designMode}
            onDesignModeChange={setDesignMode}
            phase={phase}
            error={error}
            onStartAnalysis={handleStartAnalysis}
            onWizardComplete={handleWizardComplete}
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
            onAnswerQuestion={answerQuestion}
            onCancelAnalysis={cancelAnalysis}
          />
        )}

        {phase === 'preview' && result && (
          <DesignPhasePreview
            result={result}
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
          <DesignPhaseApplied result={result} onReset={handleReset} />
        )}
      </AnimatePresence>
    </div>
  );
}
