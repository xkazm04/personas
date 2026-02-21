import { motion } from 'framer-motion';
import { CheckCircle2, Wrench, Zap, Link, ChevronDown, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import type { N8nPersonaDraft } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

export interface ConfirmResult {
  triggersCreated: number;
  toolsCreated: number;
  connectorsNeedingSetup: string[];
}

interface N8nConfirmStepProps {
  draft: N8nPersonaDraft;
  parsedResult: DesignAnalysisResult;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  created: boolean;
  confirmResult: ConfirmResult | null;
  onReset: () => void;
}

export function N8nConfirmStep({
  draft,
  parsedResult,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  created,
  confirmResult,
  onReset,
}: N8nConfirmStepProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  // Use draft entity fields if available, fall back to parser results
  const draftObj = draft as unknown as Record<string, unknown>;
  const draftTools = Array.isArray(draftObj.tools) ? draftObj.tools as { name: string; category: string; description: string }[] : null;
  const draftTriggers = Array.isArray(draftObj.triggers) ? draftObj.triggers as { trigger_type: string; description?: string }[] : null;
  const draftConnectors = Array.isArray(draftObj.required_connectors)
    ? draftObj.required_connectors as { name: string; n8n_credential_type: string; has_credential: boolean }[]
    : null;

  const selectedTools = parsedResult.suggested_tools.filter((_, i) => selectedToolIndices.has(i));
  const selectedTriggers = parsedResult.suggested_triggers.filter((_, i) => selectedTriggerIndices.has(i));
  const selectedConnectors = (parsedResult.suggested_connectors ?? []).filter((c) =>
    selectedConnectorNames.has(c.name),
  );

  const toolCount = draftTools ? draftTools.length : selectedTools.length;
  const triggerCount = draftTriggers ? draftTriggers.length : selectedTriggers.length;
  const connectorCount = draftConnectors ? draftConnectors.length : selectedConnectors.length;
  const connectorsNeedingSetup = draftConnectors?.filter((c) => !c.has_credential) ?? [];

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {created && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 300 }}
          className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: 'spring', damping: 10, stiffness: 200 }}
            className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-sm font-semibold text-emerald-400 mb-1"
          >
            Persona Created Successfully
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-xs text-emerald-400/60 mb-2"
          >
            {draft.name ?? 'Your persona'} is ready to use. Find it in the sidebar.
          </motion.p>
          {confirmResult && (confirmResult.triggersCreated > 0 || confirmResult.toolsCreated > 0) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
              className="text-[11px] text-emerald-400/50 mb-2"
            >
              Created {confirmResult.triggersCreated > 0 ? `${confirmResult.triggersCreated} trigger${confirmResult.triggersCreated !== 1 ? 's' : ''}` : ''}
              {confirmResult.triggersCreated > 0 && confirmResult.toolsCreated > 0 ? ' + ' : ''}
              {confirmResult.toolsCreated > 0 ? `${confirmResult.toolsCreated} tool${confirmResult.toolsCreated !== 1 ? 's' : ''}` : ''}
            </motion.p>
          )}
          {confirmResult && confirmResult.connectorsNeedingSetup.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-2 justify-center text-[11px] text-amber-400/60 mb-2"
            >
              <AlertTriangle className="w-3 h-3" />
              Configure connector{confirmResult.connectorsNeedingSetup.length !== 1 ? 's' : ''}: {confirmResult.connectorsNeedingSetup.join(', ')}
            </motion.div>
          )}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-3"
          >
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 text-xs rounded-lg border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Import Another
            </button>
          </motion.div>
        </motion.div>
      )}

      {/* Persona preview card */}
      {!created && (
        <div className="bg-secondary/20 border border-primary/10 rounded-2xl p-5">
          <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-3">
            Persona Preview
          </p>

          <div className="flex items-center gap-4 mb-5">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="w-14 h-14 rounded-xl flex items-center justify-center text-xl border shadow-lg"
              style={{
                backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
                borderColor: `${draft.color ?? '#8b5cf6'}30`,
                boxShadow: `0 4px 24px ${draft.color ?? '#8b5cf6'}15`,
              }}
            >
              {draft.icon ?? '✨'}
            </motion.div>
            <div>
              <p className="text-base font-semibold text-foreground/90">
                {draft.name ?? 'Unnamed Persona'}
              </p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                {draft.description ?? 'No description provided'}
              </p>
            </div>
          </div>

          {/* Entity summary grid */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="px-3 py-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
              <Wrench className="w-4 h-4 text-blue-400/60 mx-auto mb-1" />
              <p className="text-lg font-semibold text-foreground/80">{toolCount}</p>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Tools</p>
            </div>
            <div className="px-3 py-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-center">
              <Zap className="w-4 h-4 text-amber-400/60 mx-auto mb-1" />
              <p className="text-lg font-semibold text-foreground/80">{triggerCount}</p>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Triggers</p>
            </div>
            <div className="px-3 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
              <Link className="w-4 h-4 text-emerald-400/60 mx-auto mb-1" />
              <p className="text-lg font-semibold text-foreground/80">{connectorCount}</p>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Connectors</p>
            </div>
          </div>

          {/* Items breakdown — draft entities preferred over parser results */}
          {draftTools && draftTools.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {draftTools.map((tool) => (
                <span
                  key={tool.name}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-blue-500/10 text-blue-400/60 border border-blue-500/15"
                  title={tool.description}
                >
                  {tool.name}
                </span>
              ))}
            </div>
          ) : selectedTools.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {selectedTools.map((tool) => (
                <span
                  key={tool}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-blue-500/10 text-blue-400/60 border border-blue-500/15"
                >
                  {tool}
                </span>
              ))}
            </div>
          ) : null}

          {draftTriggers && draftTriggers.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {draftTriggers.map((t, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400/60 border border-amber-500/15"
                  title={t.description}
                >
                  {t.trigger_type}
                </span>
              ))}
            </div>
          ) : selectedTriggers.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {selectedTriggers.map((t, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400/60 border border-amber-500/15"
                >
                  {t.trigger_type}
                </span>
              ))}
            </div>
          ) : null}

          {/* Connectors needing setup warning */}
          {connectorsNeedingSetup.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-400/60">
                <p className="font-medium">Connectors needing setup:</p>
                <p className="mt-0.5">{connectorsNeedingSetup.map((c) => c.name).join(', ')}</p>
              </div>
            </div>
          )}

          {/* Collapsible system prompt */}
          {draft.system_prompt && (
            <div className="mt-3 border-t border-primary/10 pt-3">
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex items-center gap-2 text-xs text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors w-full"
              >
                {showPrompt ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>System Prompt Preview</span>
              </button>
              {showPrompt && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-2 p-3 rounded-lg bg-background/40 border border-primary/10 overflow-hidden"
                >
                  <p className="text-xs text-foreground/60 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {draft.system_prompt}
                  </p>
                </motion.div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation hint */}
      {!created && (
        <p className="text-xs text-amber-300/60 text-center">
          Review the details above, then click "Confirm & Save Persona" to create.
        </p>
      )}
    </div>
  );
}
