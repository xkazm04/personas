import { AnimatePresence } from 'framer-motion';
import { PhaseIndicator } from './PhaseIndicator';
import { DesignPhasePanel } from './DesignPhasePanel';
import { DesignQuestionPanel } from './DesignQuestionPanel';
import { DesignPhaseAnalyzing } from './DesignPhaseAnalyzing';
import { DesignPhaseRefining } from './DesignPhaseRefining';
import { DesignPhasePreview } from './DesignPhasePreview';
import { DesignPhaseApplying } from './DesignPhaseApplying';
import { DesignPhaseApplied } from './DesignPhaseApplied';
import { DesignConversationHistory } from './DesignConversationHistory';
import type { DesignAnalysisResult, IntentCompilationResult, DesignPhase, DesignQuestion, DesignConversation } from '@/lib/types/designTypes';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

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
  onIntentModeChange: (v: boolean) => void;
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
  onReset: () => void;
  conversations: DesignConversation[];
  activeConversationId: string | null;
  onResumeConversation: (conversation: DesignConversation) => void;
  onDeleteConversation: (id: string) => void;
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
  onIntentModeChange,
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
  onReset,
  conversations,
  activeConversationId,
  onResumeConversation,
  onDeleteConversation,
}: DesignTabPhaseContentProps) {
  return (
    <div className="space-y-4" aria-live="polite" aria-atomic="true">
      <PhaseIndicator phase={phase} />

      {/* Conversation history -- always visible in idle phase */}
      {phase === 'idle' && conversations.length > 0 && (
        <DesignConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          onResumeConversation={onResumeConversation}
          onDeleteConversation={onDeleteConversation}
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
            onIntentModeChange={onIntentModeChange}
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
          <DesignPhaseApplied result={result} warnings={applyWarnings} onReset={onReset} />
        )}
      </AnimatePresence>
    </div>
  );
}
