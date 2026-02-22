import { Send, Check, RefreshCw, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { DesignResultPreview } from '@/features/templates/sub_generated/DesignResultPreview';
import { DesignChatInput } from '@/features/templates/sub_generated/DesignChatInput';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DesignPhasePreviewProps {
  result: DesignAnalysisResult;
  error: string | null;
  toolDefinitions: DbPersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  selectedTools: Set<string>;
  selectedTriggerIndices: Set<number>;
  selectedChannelIndices: Set<number>;
  selectedSubscriptionIndices: Set<number>;
  onToolToggle: (toolName: string) => void;
  onTriggerToggle: (index: number) => void;
  onChannelToggle: (index: number) => void;
  onSubscriptionToggle: (index: number) => void;
  changeSummary: string[];
  refinementMessage: string;
  onRefinementMessageChange: (value: string) => void;
  onApply: () => void;
  onRefine: () => void;
  onDiscard: () => void;
  onSendRefinement: () => void;
}

export function DesignPhasePreview({
  result,
  error,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
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
}: DesignPhasePreviewProps) {
  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="space-y-4"
    >
      <DesignResultPreview
        result={result}
        allToolDefs={toolDefinitions}
        currentToolNames={currentToolNames}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        selectedTools={selectedTools}
        selectedTriggerIndices={selectedTriggerIndices}
        selectedChannelIndices={selectedChannelIndices}
        suggestedSubscriptions={result.suggested_event_subscriptions}
        selectedSubscriptionIndices={selectedSubscriptionIndices}
        onToolToggle={onToolToggle}
        onTriggerToggle={onTriggerToggle}
        onChannelToggle={onChannelToggle}
        onSubscriptionToggle={onSubscriptionToggle}
        onConnectorClick={() => {}}
        feasibility={result.feasibility}
      />

      {error && (
        <p className="text-sm text-red-400 px-1">{error}</p>
      )}

      {/* Change summary */}
      {changeSummary.length > 0 && (
        <div className="px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
          <div className="flex items-start gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground/70">
              <span className="font-medium text-foreground/70">Will apply: </span>
              {changeSummary.join(', ').toLowerCase()}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onApply}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-gradient-to-r from-primary to-accent text-foreground hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <Check className="w-3.5 h-3.5" />
          Apply Changes
        </button>
        <button
          onClick={onRefine}
          className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm bg-secondary/50 text-foreground/70 hover:bg-secondary/70 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refine
        </button>
        <button
          onClick={onDiscard}
          className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground/60 transition-colors"
        >
          Discard
        </button>
      </div>

      {/* Refinement chat input */}
      <DesignChatInput
        value={refinementMessage}
        onChange={onRefinementMessageChange}
        onSubmit={onSendRefinement}
        placeholder="Describe what to change..."
        buttonLabel="Send"
        buttonIcon={Send}
        variant="secondary"
      />
    </motion.div>
  );
}
