import { useDesignTabState } from './useDesignTabState';
import { DesignTabPhaseContent } from './DesignTabPhaseContent';

export function DesignTab() {
  const {
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
  } = useDesignTabState();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <DesignTabPhaseContent
      phase={phase}
      selectedPersona={selectedPersona}
      toolDefinitions={toolDefinitions}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      currentToolNames={currentToolNames}
      savedDesignResult={savedDesignResult}
      instruction={instruction}
      onInstructionChange={setInstruction}
      designContext={designContext}
      onDesignContextChange={setDesignContext}
      error={error}
      onStartAnalysis={handleStartAnalysis}
      intentMode={intentMode}
      onIntentModeChange={setIntentMode}
      outputLines={outputLines}
      result={result}
      question={question}
      onCancel={cancelAnalysis}
      onAnswerQuestion={handleAnswerQuestion}
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
      applyWarnings={applyWarnings}
      onReset={handleReset}
      conversations={conversations}
      activeConversationId={activeConversationId}
      onResumeConversation={handleResumeConversation}
      onDeleteConversation={removeConversation}
    />
  );
}
