import { motion } from 'framer-motion';
import { CheckCircle2, Wrench, Zap, Link, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, Brain, Activity, ShieldCheck } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { extractProtocolCapabilities, countByType } from './edit/protocolParser';
import { usePersonaStore } from '@/stores/personaStore';

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
  const draftTools = Array.isArray(draftObj.tools) ? draftObj.tools as { name: string; category: string; description: string; requires_credential_type?: string }[] : null;
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
  const credentialLinks = parseDesignContext(draft.design_context).credential_links ?? {};
  const connectorsNeedingSetup = draftConnectors?.filter(
    (c) => !c.has_credential && !credentialLinks[c.name],
  ) ?? [];

  // Protocol capability counts from prompt analysis
  const capabilities = useMemo(
    () => extractProtocolCapabilities(
      draft.system_prompt,
      draft.structured_prompt as Record<string, unknown> | null,
    ),
    [draft.system_prompt, draft.structured_prompt],
  );
  const capCounts = useMemo(() => countByType(capabilities), [capabilities]);
  const reviewCount = capCounts.manual_review;
  const memoryCount = capCounts.agent_memory;
  const eventCount = capCounts.emit_event || triggerCount;

  // Tool-credential validation
  const credentials = usePersonaStore((s) => s.credentials);
  const toolsNeedingCredentials = useMemo(() => {
    if (!draftTools) return [];
    return draftTools.filter((tool) => {
      if (!tool.requires_credential_type) return false;
      const credType = tool.requires_credential_type;
      // Check if linked via credential_links
      if (credentialLinks[credType]) return false;
      // Check if any credential with matching service_type exists
      const hasMatchingCred = credentials.some(
        (c) => c.service_type === credType || c.name.toLowerCase().includes(credType.toLowerCase()),
      );
      return !hasMatchingCred;
    });
  }, [draftTools, credentialLinks, credentials]);

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
            className="text-sm text-emerald-400/60 mb-2"
          >
            {draft.name ?? 'Your persona'} is ready to use. Find it in the sidebar.
          </motion.p>
          {confirmResult && (confirmResult.triggersCreated > 0 || confirmResult.toolsCreated > 0) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 }}
              className="text-sm text-emerald-400/50 mb-2"
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
              className="flex items-center gap-2 justify-center text-sm text-amber-400/60 mb-2"
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
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
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
          <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider mb-3">
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
              <p className="text-sm text-muted-foreground/65 mt-0.5">
                {draft.description ?? 'No description provided'}
              </p>
            </div>
          </div>

          {/* Entity summary grid — 6 cards */}
          <div className="grid grid-cols-6 gap-2 mb-4">
            <div className="px-2 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
              <Wrench className="w-3.5 h-3.5 text-blue-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{toolCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Tools</p>
            </div>
            <div className="px-2 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/10 text-center">
              <Zap className="w-3.5 h-3.5 text-amber-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{triggerCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Triggers</p>
            </div>
            <div className="px-2 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
              <Link className="w-3.5 h-3.5 text-emerald-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{connectorCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Connectors</p>
            </div>
            <div className="px-2 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/10 text-center">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{reviewCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Reviews</p>
            </div>
            <div className="px-2 py-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-center">
              <Brain className="w-3.5 h-3.5 text-cyan-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{memoryCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Memory</p>
            </div>
            <div className="px-2 py-2.5 rounded-xl bg-orange-500/5 border border-orange-500/10 text-center">
              <Activity className="w-3.5 h-3.5 text-orange-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80">{eventCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Events</p>
            </div>
          </div>

          {/* Items breakdown — draft entities preferred over parser results */}
          {draftTools && draftTools.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {draftTools.map((tool) => (
                <span
                  key={tool.name}
                  className="px-2 py-0.5 text-sm font-mono rounded bg-blue-500/10 text-blue-400/60 border border-blue-500/15"
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
                  className="px-2 py-0.5 text-sm font-mono rounded bg-blue-500/10 text-blue-400/60 border border-blue-500/15"
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
                  className="px-2 py-0.5 text-sm font-mono rounded bg-amber-500/10 text-amber-400/60 border border-amber-500/15"
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
                  className="px-2 py-0.5 text-sm font-mono rounded bg-amber-500/10 text-amber-400/60 border border-amber-500/15"
                >
                  {t.trigger_type}
                </span>
              ))}
            </div>
          ) : null}

          {/* Connector badges */}
          {draftConnectors && draftConnectors.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {draftConnectors.map((c) => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono rounded bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/15"
                  title={`n8n type: ${c.n8n_credential_type}`}
                >
                  {c.name}
                  {c.has_credential && <CheckCircle2 className="w-2.5 h-2.5" />}
                </span>
              ))}
            </div>
          )}

          {/* Protocol capability badges */}
          {capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {capabilities.map((cap) => {
                const styles: Record<string, string> = {
                  manual_review: 'bg-rose-500/10 text-rose-400/60 border-rose-500/15',
                  user_message: 'bg-amber-500/10 text-amber-400/60 border-amber-500/15',
                  agent_memory: 'bg-cyan-500/10 text-cyan-400/60 border-cyan-500/15',
                  emit_event: 'bg-violet-500/10 text-violet-400/60 border-violet-500/15',
                };
                return (
                  <span
                    key={cap.type}
                    className={`px-2 py-0.5 text-sm font-mono rounded border ${styles[cap.type] ?? ''}`}
                    title={cap.context}
                  >
                    {cap.label.toLowerCase()}
                  </span>
                );
              })}
            </div>
          )}

          {/* Connectors needing setup warning */}
          {connectorsNeedingSetup.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-400/60">
                <p className="font-medium">Connectors needing setup:</p>
                <p className="mt-0.5">{connectorsNeedingSetup.map((c) => c.name).join(', ')}</p>
              </div>
            </div>
          )}

          {/* Tool-credential validation warning */}
          {toolsNeedingCredentials.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-400/60">
                <p className="font-medium">
                  {toolsNeedingCredentials.length} tool{toolsNeedingCredentials.length !== 1 ? 's' : ''} require credentials not yet configured:
                </p>
                <p className="mt-0.5 font-mono">
                  {toolsNeedingCredentials.map((t) => `${t.name} (${t.requires_credential_type})`).join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Collapsible system prompt */}
          {draft.system_prompt && (
            <div className="mt-3 border-t border-primary/10 pt-3">
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex items-center gap-2 text-sm text-muted-foreground/65 hover:text-muted-foreground transition-colors w-full"
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
                  <div className="text-sm max-h-48 overflow-y-auto leading-relaxed">
                    <MarkdownRenderer content={draft.system_prompt} />
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation hint */}
      {!created && (
        <p className="text-sm text-amber-300/60 text-center">
          Review the details above, then click "Confirm & Save Persona" to create.
        </p>
      )}
    </div>
  );
}
