import { useEffect, useRef, useState } from 'react';
import { Send, Check, RefreshCw, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { DesignResultPreview } from '@/features/templates/sub_generated';
import { IntentResultExtras } from './IntentResultExtras';

import type { DesignAnalysisResult, IntentCompilationResult } from '@/lib/types/designTypes';
import type { DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DesignPreviewResources {
  toolDefinitions: DbPersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

interface DesignPreviewSelections {
  tools: Set<string>;
  triggerIndices: Set<number>;
  channelIndices: Set<number>;
  subscriptionIndices: Set<number>;
}

interface DesignPreviewSelectionHandlers {
  onToolToggle: (toolName: string) => void;
  onTriggerToggle: (index: number) => void;
  onChannelToggle: (index: number) => void;
  onSubscriptionToggle: (index: number) => void;
}

interface DesignPreviewRefinement {
  message: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
}

interface DesignPreviewActions {
  onApply: () => void;
  onRefine: () => void;
  onDiscard: () => void;
}

interface DesignPhasePreviewProps {
  result: DesignAnalysisResult;
  intentResult?: IntentCompilationResult;
  error: string | null;
  resources: DesignPreviewResources;
  selections: DesignPreviewSelections;
  selectionHandlers: DesignPreviewSelectionHandlers;
  changeSummary: string[];
  refinement: DesignPreviewRefinement;
  actions: DesignPreviewActions;
}

export function DesignPhasePreview({
  result,
  intentResult,
  error,
  resources,
  selections,
  selectionHandlers,
  changeSummary,
  refinement,
  actions,
}: DesignPhasePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirmDiscard) return;
    const timer = setTimeout(() => setConfirmDiscard(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDiscard]);

  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -6 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="space-y-4"
      ref={containerRef}
      tabIndex={-1}
    >
      <DesignResultPreview
        result={result}
        allToolDefs={resources.toolDefinitions}
        currentToolNames={resources.currentToolNames}
        credentials={resources.credentials}
        connectorDefinitions={resources.connectorDefinitions}
        selectedTools={selections.tools}
        selectedTriggerIndices={selections.triggerIndices}
        selectedChannelIndices={selections.channelIndices}
        suggestedSubscriptions={result.suggested_event_subscriptions}
        selectedSubscriptionIndices={selections.subscriptionIndices}
        onToolToggle={selectionHandlers.onToolToggle}
        onTriggerToggle={selectionHandlers.onTriggerToggle}
        onChannelToggle={selectionHandlers.onChannelToggle}
        onSubscriptionToggle={selectionHandlers.onSubscriptionToggle}
        onConnectorClick={() => {}}
        feasibility={result.feasibility}
      />

      {/* Intent compiler extras (use cases, model recommendation, test scenarios) */}
      {intentResult && <IntentResultExtras result={intentResult} />}

      {error && (
        <p className="text-sm text-red-400 px-1">{error}</p>
      )}

      {/* Change summary */}
      {changeSummary.length > 0 && (
        <div className="px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
          <div className="flex items-start gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground/90">
              <span className="font-medium text-foreground/90">Will apply: </span>
              {changeSummary.join(', ').toLowerCase()}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={actions.onApply}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-gradient-to-r from-primary to-accent text-foreground hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <Check className="w-3.5 h-3.5" />
          Apply Changes
        </button>
        <button
          onClick={actions.onRefine}
          className="flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm bg-secondary/50 text-foreground/90 hover:bg-secondary/70 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refine
        </button>
        <button
          onClick={() => {
            if (confirmDiscard) {
              setConfirmDiscard(false);
              actions.onDiscard();
              return;
            }
            setConfirmDiscard(true);
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl font-medium text-sm transition-colors ${
            confirmDiscard
              ? 'text-red-400 hover:text-red-300'
              : 'text-muted-foreground hover:text-foreground/95'
          }`}
        >
          {confirmDiscard ? 'Confirm discard?' : 'Discard'}
        </button>
      </div>

      {/* Refinement chat input */}
      <div className="flex items-end gap-2">
        <textarea
          value={refinement.message}
          onChange={(e) => refinement.onMessageChange(e.target.value)}
          placeholder="Describe what to change..."
          className="flex-1 min-h-[60px] max-h-[120px] bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (refinement.message.trim()) refinement.onSend();
            }
          }}
        />
        <button
          onClick={refinement.onSend}
          disabled={!refinement.message.trim()}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
            !refinement.message.trim()
              ? 'bg-secondary/40 text-muted-foreground/80 cursor-not-allowed'
              : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          Send
        </button>
      </div>
      <p className="text-sm text-muted-foreground/60 px-1">Press Enter to submit, Shift+Enter for new line.</p>
    </motion.div>
  );
}
