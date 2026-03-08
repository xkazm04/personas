import { AnimatePresence } from 'framer-motion';
import { PhaseIndicator } from './PhaseIndicator';
import { DesignPhasePanel } from './DesignPhasePanel';
import { DesignQuestionPanel } from './DesignQuestionPanel';
import { DesignPhaseAnalyzing } from './DesignPhaseAnalyzing';
import { DesignPhaseRefining } from './DesignPhaseRefining';
import { DesignPhasePreview } from './DesignPhasePreview';
import { DesignPhaseApplying } from './DesignPhaseApplying';
import { DesignPhaseApplied } from './DesignPhaseApplied';
import { DesignPhaseError } from './DesignPhaseError';
import { DesignConversationHistory } from './DesignConversationHistory';
import type { DesignAnalysisResult, IntentCompilationResult, DesignPhase, DesignQuestion, DesignConversation } from '@/lib/types/designTypes';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { FailedOperation } from '@/hooks/design/applyDesignResult';
import type { DesignDriftEvent } from '@/lib/design/designDrift';
import type { ExamplePair } from './ExamplePairCollector';
import type { DesignInputMode } from './useDesignTabState';

export interface DesignTabPhaseContentProps {
  phase: DesignPhase;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: DbPersonaToolDefinition[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  currentToolNames: string[];
  savedDesignResult: DesignAnalysisResult | null;
  instruction: string;
  onInstructionChange: (v: string) => void;
  designContext: DesignFilesSection;
  onDesignContextChange: (ctx: DesignFilesSection) => void;
  error: string | null;
  onStartAnalysis: () => void;
  intentMode: boolean;
  inputMode: DesignInputMode;
  onInputModeChange: (mode: DesignInputMode) => void;
  examplePairs: ExamplePair[];
  onExamplePairsChange: (pairs: ExamplePair[]) => void;
  outputLines: string[];
  result: DesignAnalysisResult | null;
  question: DesignQuestion | null;
  onCancel: () => void;
  onAnswerQuestion: (answer: string) => void;
  selectedTools: Set<string>;
  selectedTriggerIndices: Set<number>;
  selectedChannelIndices: Set<number>;
  selectedSubscriptionIndices: Set<number>;
  onToolToggle: (t: string) => void;
  onTriggerToggle: (i: number) => void;
  onChannelToggle: (i: number) => void;
  onSubscriptionToggle: (i: number) => void;
  changeSummary: string[];
  refinementMessage: string;
  onRefinementMessageChange: (v: string) => void;
  onApply: () => void;
  onRefine: () => void;
  onDiscard: () => void;
  onSendRefinement: () => void;
  applyWarnings?: string[];
  failedOperations?: FailedOperation[];
  onRetryFailed?: () => void;
  onReset: () => void;
  conversations: DesignConversation[];
  activeConversationId: string | null;
  onResumeConversation: (conversation: DesignConversation) => void;
  onDeleteConversation: (id: string) => void;
  onRetry: () => void;
  driftEvents?: DesignDriftEvent[];
  onDismissDrift?: (id: string) => void;
}

export function DesignTabPhaseContent({
  phase,
  selectedPersona,
  toolDefinitions,
  credentials,
  connectorDefinitions,
  currentToolNames,
  savedDesignResult,
  instruction,
  onInstructionChange,
  designContext,
  onDesignContextChange,
  error,
  onStartAnalysis,
  intentMode,
  inputMode,
  onInputModeChange,
  examplePairs,
  onExamplePairsChange,
  outputLines,
  result,
  question,
  onCancel,
  onAnswerQuestion,
  selectedTools,
  selectedTriggerIndices,
  selectedChannelIndices,
  selectedSubscriptionIndices,
  onToolToggle,
  onTriggerToggle,
  onChannelToggle,
  onSubscriptionToggle,
  changeSummary,
  refinementMessage,
  onRefinementMessageChange,
  onApply,
  onRefine,
  onDiscard,
  onSendRefinement,
  applyWarnings,
  failedOperations,
  onRetryFailed,
  onReset,
  conversations,
  activeConversationId,
  onResumeConversation,
  onDeleteConversation,
  onRetry,
  driftEvents,
  onDismissDrift,
}: DesignTabPhaseContentProps) {
  return (
    <div className="space-y-4" aria-live="polite" aria-atomic="true">
      <PhaseIndicator phase={phase} />

      {/* Conversation history + drift notifications -- always visible in idle phase */}
      {phase === 'idle' && (conversations.length > 0 || (driftEvents && driftEvents.some(e => !e.dismissed))) && (
        <DesignConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          onResumeConversation={onResumeConversation}
          onDeleteConversation={onDeleteConversation}
          driftEvents={driftEvents}
          onDismissDrift={onDismissDrift}
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
            onInstructionChange={onInstructionChange}
            designContext={designContext}
            onDesignContextChange={onDesignContextChange}
            phase={phase}
            error={error}
            onStartAnalysis={onStartAnalysis}
            intentMode={intentMode}
            inputMode={inputMode}
            onInputModeChange={onInputModeChange}
            examplePairs={examplePairs}
            onExamplePairsChange={onExamplePairsChange}
          />
        )}

        {phase === 'analyzing' && (
          <DesignPhaseAnalyzing
            instruction={instruction}
            outputLines={outputLines}
            savedDesignResult={savedDesignResult}
            onCancel={onCancel}
          />
        )}

        {phase === 'refining' && (
          <DesignPhaseRefining
            outputLines={outputLines}
            result={result}
            onCancel={onCancel}
          />
        )}

        {phase === 'awaiting-input' && question && (
          <DesignQuestionPanel
            outputLines={outputLines}
            question={question}
            onAnswerQuestion={onAnswerQuestion}
            onCancelAnalysis={onCancel}
          />
        )}

        {phase === 'preview' && result && (
          <DesignPhasePreview
            result={result}
            intentResult={intentMode ? (result as IntentCompilationResult) : undefined}
            error={error}
            resources={{
              toolDefinitions,
              currentToolNames,
              credentials,
              connectorDefinitions,
            }}
            selections={{
              tools: selectedTools,
              triggerIndices: selectedTriggerIndices,
              channelIndices: selectedChannelIndices,
              subscriptionIndices: selectedSubscriptionIndices,
            }}
            selectionHandlers={{
              onToolToggle,
              onTriggerToggle,
              onChannelToggle,
              onSubscriptionToggle,
            }}
            changeSummary={changeSummary}
            refinement={{
              message: refinementMessage,
              onMessageChange: onRefinementMessageChange,
              onSend: onSendRefinement,
            }}
            actions={{
              onApply,
              onRefine,
              onDiscard,
            }}
          />
        )}

        {phase === 'applying' && <DesignPhaseApplying />}

        {phase === 'applied' && (
          <DesignPhaseApplied result={result} warnings={applyWarnings} failedOperations={failedOperations} onRetryFailed={onRetryFailed} onReset={onReset} />
        )}

        {phase === 'error' && (
          <DesignPhaseError error={error} onRetry={onRetry} onReset={onReset} />
        )}
      </AnimatePresence>
    </div>
  );
}
