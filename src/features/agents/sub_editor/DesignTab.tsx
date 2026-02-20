import { useState, useMemo, useEffect } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useDesignAnalysis } from '@/hooks/useDesignAnalysis';
import { useToggleSet } from '@/hooks/useToggleSet';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { DesignTerminal } from '@/features/templates/sub_generated/DesignTerminal';
import { DesignResultPreview } from '@/features/templates/sub_generated/DesignResultPreview';
import { Sparkles, Send, X, Check, RefreshCw, Loader2, Pencil, ArrowRight, Wrench, Zap, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { DesignInput } from '@/features/templates/sub_generated/DesignInput';
import { DesignChatInput } from '@/features/templates/sub_generated/DesignChatInput';
import { PhaseIndicator } from '@/features/agents/sub_editor/PhaseIndicator';
import type { DesignContext } from '@/lib/types/frontendTypes';

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
    startAnalysis,
    cancelAnalysis,
    refineAnalysis,
    applyResult,
    reset,
  } = useDesignAnalysis();

  const [instruction, setInstruction] = useState('');
  const [designContext, setDesignContext] = useState<DesignContext>({ files: [], references: [] });
  const [refinementMessage, setRefinementMessage] = useState('');
  const [selectedTools, handleToolToggle, setSelectedTools] = useToggleSet<string>();
  const [selectedTriggerIndices, handleTriggerToggle, setSelectedTriggerIndices] = useToggleSet<number>();
  const [selectedChannelIndices, handleChannelToggle, setSelectedChannelIndices] = useToggleSet<number>();
  const [selectedSubscriptionIndices, handleSubscriptionToggle, setSelectedSubscriptionIndices] = useToggleSet<number>();


  // Parse saved design result from persona DB
  const savedDesignResult = useMemo<DesignAnalysisResult | null>(() => {
    if (!selectedPersona?.last_design_result) return null;
    try {
      const parsed = JSON.parse(selectedPersona.last_design_result) as DesignAnalysisResult;
      const GOOGLE_CONNECTORS = new Set(['gmail', 'google_calendar', 'google_drive']);
      parsed.suggested_connectors?.forEach((c) => {
        if (!c.oauth_type && GOOGLE_CONNECTORS.has(c.name)) {
          c.oauth_type = 'google';
        }
      });
      return parsed;
    } catch {
      return null;
    }
  }, [selectedPersona?.last_design_result]);

  // Initialize design context from persona DB
  useEffect(() => {
    if (selectedPersona?.design_context) {
      try {
        const saved = JSON.parse(selectedPersona.design_context) as DesignContext;
        setDesignContext(saved);
      } catch {
        setDesignContext({ files: [], references: [] });
      }
    } else {
      setDesignContext({ files: [], references: [] });
    }
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
        {/* Phase: idle */}
        {phase === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {savedDesignResult ? (
              <>
                {/* Read-only overview of saved design */}
                <DesignResultPreview
                  result={savedDesignResult}
                  allToolDefs={toolDefinitions}
                  currentToolNames={currentToolNames}
                  credentials={credentials}
                  connectorDefinitions={connectorDefinitions}
                  selectedTools={new Set(savedDesignResult.suggested_tools)}
                  selectedTriggerIndices={new Set(savedDesignResult.suggested_triggers.map((_: unknown, i: number) => i))}
                  selectedChannelIndices={new Set((savedDesignResult.suggested_notification_channels || []).map((_: unknown, i: number) => i))}
                  suggestedSubscriptions={savedDesignResult.suggested_event_subscriptions}
                  selectedSubscriptionIndices={new Set((savedDesignResult.suggested_event_subscriptions || []).map((_: unknown, i: number) => i))}
                  onToolToggle={() => {}}
                  onTriggerToggle={() => {}}
                  onChannelToggle={() => {}}
                  onConnectorClick={() => {}}
                  readOnly
                  actualTriggers={selectedPersona.triggers || []}
                  feasibility={savedDesignResult.feasibility}
                />

                {/* Chat input for modifications */}
                <div className="pt-2 border-t border-primary/10 space-y-2">
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground/50">
                    <Pencil className="w-3 h-3 shrink-0" />
                    <span>Current configuration will be preserved. Describe what to change.</span>
                  </div>
                  <DesignChatInput
                    value={instruction}
                    onChange={setInstruction}
                    onSubmit={handleStartAnalysis}
                    placeholder="Describe changes to this design..."
                    buttonLabel="Update Design"
                    buttonIcon={Pencil}
                    variant="primary"
                  />
                </div>
              </>
            ) : (
              <>
                {/* Fresh design */}
                <DesignInput
                  instruction={instruction}
                  onInstructionChange={setInstruction}
                  designContext={designContext}
                  onDesignContextChange={setDesignContext}
                  disabled={phase !== 'idle'}
                  onSubmit={handleStartAnalysis}
                />

                {error && (
                  <p className="text-sm text-red-400 px-1">{error}</p>
                )}

                <button
                  onClick={handleStartAnalysis}
                  disabled={!instruction.trim()}
                  className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-xl font-medium text-sm transition-all w-full ${
                    !instruction.trim()
                      ? 'bg-secondary/60 text-muted-foreground/40 cursor-not-allowed'
                      : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Analyze &amp; Build
                </button>
              </>
            )}
          </motion.div>
        )}

        {/* Phase: analyzing */}
        {phase === 'analyzing' && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {savedDesignResult && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground/50">
                <Pencil className="w-3 h-3 shrink-0" />
                <span>Updating design...</span>
              </div>
            )}
            <div className="bg-secondary/30 rounded-xl px-4 py-3 text-sm text-foreground/70 border border-primary/15">
              {instruction}
            </div>

            <DesignTerminal lines={outputLines} isRunning={true} />

            <button
              onClick={cancelAnalysis}
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </motion.div>
        )}

        {/* Phase: refining */}
        {phase === 'refining' && (
          <motion.div
            key="refining"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {result && (
              <div className="bg-secondary/30 rounded-xl px-4 py-3 border border-primary/15">
                <p className="text-sm text-muted-foreground/50 mb-1">Current design</p>
                <p className="text-sm text-foreground/70">{result.summary}</p>
              </div>
            )}

            <DesignTerminal lines={outputLines} isRunning={true} />

            <button
              onClick={cancelAnalysis}
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </motion.div>
        )}

        {/* Phase: preview */}
        {phase === 'preview' && result && (
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
              onToolToggle={handleToolToggle}
              onTriggerToggle={handleTriggerToggle}
              onChannelToggle={handleChannelToggle}
              onSubscriptionToggle={handleSubscriptionToggle}
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
                onClick={handleApply}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-gradient-to-r from-primary to-accent text-foreground hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                <Check className="w-3.5 h-3.5" />
                Apply Changes
              </button>
              <button
                onClick={handleRefine}
                className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm bg-secondary/50 text-foreground/70 hover:bg-secondary/70 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refine
              </button>
              <button
                onClick={handleDiscard}
                className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground/60 transition-colors"
              >
                Discard
              </button>
            </div>

            {/* Refinement chat input */}
            <DesignChatInput
              value={refinementMessage}
              onChange={setRefinementMessage}
              onSubmit={handleSendRefinement}
              placeholder="Describe what to change..."
              buttonLabel="Send"
              buttonIcon={Send}
              variant="secondary"
            />
          </motion.div>
        )}

        {/* Phase: applying */}
        {phase === 'applying' && (
          <motion.div
            key="applying"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <span className="text-sm text-muted-foreground/60">Applying changes...</span>
          </motion.div>
        )}

        {/* Phase: applied */}
        {phase === 'applied' && (
          <motion.div
            key="applied"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="text-sm text-emerald-400 font-medium">
              Design applied successfully!
            </span>

            {result && (
              <div className="mt-2 w-full max-w-sm space-y-2">
                <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
                  {(result.suggested_tools?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Wrench className="w-3 h-3" />
                      {result.suggested_tools.length} tool{result.suggested_tools.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {(result.suggested_triggers?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Zap className="w-3 h-3" />
                      {result.suggested_triggers.length} trigger{result.suggested_triggers.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {(result.suggested_notification_channels?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Bell className="w-3 h-3" />
                      {result.suggested_notification_channels!.length} channel{result.suggested_notification_channels!.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {result.summary && (
                  <p className="text-xs text-muted-foreground/40 text-center line-clamp-2">
                    {result.summary}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleReset}
              className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/50 text-foreground/70 hover:bg-secondary/70 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
