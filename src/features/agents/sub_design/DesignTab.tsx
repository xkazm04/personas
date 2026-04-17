import { useDesignTabState } from './libs/useDesignTabState';
import { DesignTabPhaseContent } from './components/DesignTabPhaseContent';
import { useTranslation } from '@/i18n/useTranslation';

export function DesignTab() {
  const { t } = useTranslation();
  const {
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
  } = useDesignTabState();

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-foreground">
        <p className="typo-body">{t.agents.design.select_agent}</p>
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
      inputMode={inputMode}
      onInputModeChange={setInputMode}
      examplePairs={examplePairs}
      onExamplePairsChange={setExamplePairs}
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
      failedOperations={failedOperations}
      onRetryFailed={retryFailed}
      onReset={handleReset}
      conversations={conversations}
      activeConversationId={activeConversationId}
      onResumeConversation={handleResumeConversation}
      onDeleteConversation={removeConversation}
      onRetry={handleStartAnalysis}
      driftEvents={driftEvents}
      onDismissDrift={dismissDriftEvent}
    />
  );
}
