import { DesignPhasePanel } from '../phases/DesignPhasePanel';
import { DesignQuestionPanel } from '../DesignQuestionPanel';
import { DesignPhaseAnalyzing } from '../phases/DesignPhaseAnalyzing';
import { DesignPhaseRefining } from '../phases/DesignPhaseRefining';
import { DesignPhasePreview } from '../phases/DesignPhasePreview';
import { DesignPhaseApplying } from '../phases/DesignPhaseApplying';
import { DesignPhaseApplied } from '../phases/DesignPhaseApplied';
import { DesignPhaseError } from '../phases/DesignPhaseError';
import type { AgentIR, IntentCompilationResult, DesignQuestion } from '@/lib/types/designTypes';
import type { DesignFilesSection } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { FailedOperation } from '@/hooks/design/credential/applyDesignResult';
import type { ExamplePair } from '../wizard/ExamplePairCollector';
import type { DesignInputMode } from '../libs/useDesignTabState';

export interface PhaseRenderProps {
  phase: string;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: PersonaToolDefinition[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  currentToolNames: string[];
  savedDesignResult: AgentIR | null;
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
  result: AgentIR | null;
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
  onRetry: () => void;
}

export function renderPhaseContent(p: PhaseRenderProps) {
  if (p.phase === 'idle') {
    return (
      <DesignPhasePanel
        savedDesignResult={p.savedDesignResult} selectedPersona={p.selectedPersona}
        toolDefinitions={p.toolDefinitions} currentToolNames={p.currentToolNames}
        credentials={p.credentials} connectorDefinitions={p.connectorDefinitions}
        instruction={p.instruction} onInstructionChange={p.onInstructionChange}
        designContext={p.designContext} onDesignContextChange={p.onDesignContextChange}
        phase={p.phase} error={p.error} onStartAnalysis={p.onStartAnalysis}
        intentMode={p.intentMode} inputMode={p.inputMode} onInputModeChange={p.onInputModeChange}
        examplePairs={p.examplePairs} onExamplePairsChange={p.onExamplePairsChange}
      />
    );
  }
  if (p.phase === 'analyzing') {
    return <DesignPhaseAnalyzing instruction={p.instruction} outputLines={p.outputLines} savedDesignResult={p.savedDesignResult} onCancel={p.onCancel} />;
  }
  if (p.phase === 'refining') {
    return <DesignPhaseRefining outputLines={p.outputLines} result={p.result} onCancel={p.onCancel} />;
  }
  if (p.phase === 'awaiting-input' && p.question) {
    return <DesignQuestionPanel outputLines={p.outputLines} question={p.question} onAnswerQuestion={p.onAnswerQuestion} onCancelAnalysis={p.onCancel} />;
  }
  if (p.phase === 'preview' && p.result) {
    return (
      <DesignPhasePreview
        result={p.result}
        intentResult={p.intentMode ? (p.result as IntentCompilationResult) : undefined}
        error={p.error}
        resources={{ toolDefinitions: p.toolDefinitions, currentToolNames: p.currentToolNames, credentials: p.credentials, connectorDefinitions: p.connectorDefinitions }}
        selections={{ tools: p.selectedTools, triggerIndices: p.selectedTriggerIndices, channelIndices: p.selectedChannelIndices, subscriptionIndices: p.selectedSubscriptionIndices }}
        selectionHandlers={{ onToolToggle: p.onToolToggle, onTriggerToggle: p.onTriggerToggle, onChannelToggle: p.onChannelToggle, onSubscriptionToggle: p.onSubscriptionToggle }}
        changeSummary={p.changeSummary}
        refinement={{ message: p.refinementMessage, onMessageChange: p.onRefinementMessageChange, onSend: p.onSendRefinement }}
        actions={{ onApply: p.onApply, onRefine: p.onRefine, onDiscard: p.onDiscard }}
      />
    );
  }
  if (p.phase === 'applying') return <DesignPhaseApplying />;
  if (p.phase === 'applied') {
    return <DesignPhaseApplied result={p.result} warnings={p.applyWarnings} failedOperations={p.failedOperations} onRetryFailed={p.onRetryFailed} onReset={p.onReset} />;
  }
  if (p.phase === 'error') {
    return <DesignPhaseError error={p.error} onRetry={p.onRetry} onReset={p.onReset} />;
  }
  return null;
}
