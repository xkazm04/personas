import { motion } from 'framer-motion';
import { CheckCircle2, Wrench, Zap, Link, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, Brain, Activity, ShieldCheck, XCircle } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { translateHealthcheckMessage } from '@/features/vault/components/credential-design/CredentialDesignHelpers';
import { extractProtocolCapabilities, countByType } from './edit/protocolParser';
import { matchCredentialToConnector } from './edit/connectorMatching';
import { usePersonaStore } from '@/stores/personaStore';

export interface EntityError {
  entity_type: string;
  entity_name: string;
  error: string;
}

export interface ConfirmResult {
  triggersCreated: number;
  toolsCreated: number;
  connectorsNeedingSetup: string[];
  entityErrors: EntityError[];
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
  const draftTools = draft.tools ?? null;
  const draftTriggers = draft.triggers ?? null;
  const draftConnectors = draft.required_connectors ?? null;

  const selectedTools = parsedResult.suggested_tools.filter((_, i) => selectedToolIndices.has(i));
  const selectedTriggers = parsedResult.suggested_triggers.filter((_, i) => selectedTriggerIndices.has(i));
  const selectedConnectors = (parsedResult.suggested_connectors ?? []).filter((c) =>
    selectedConnectorNames.has(c.name),
  );

  const toolCount = draftTools ? draftTools.length : selectedTools.length;
  const triggerCount = draftTriggers ? draftTriggers.length : selectedTriggers.length;
  const connectorCount = draftConnectors ? draftConnectors.length : selectedConnectors.length;
  const credentialLinks = parseDesignContext(draft.design_context).credentialLinks ?? {};

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
      // Check if any credential matches this connector
      return !matchCredentialToConnector(credentials, credType);
    });
  }, [draftTools, credentialLinks, credentials]);

  // Connector health statuses for the rail
  type ConnectorHealth = 'ready' | 'missing' | 'failed';
  interface ConnectorRailItem {
    name: string;
    health: ConnectorHealth;
    credentialName: string | null;
    errorMessage: string | null;
  }

  const connectorRailItems = useMemo((): ConnectorRailItem[] => {
    if (!draftConnectors) return [];
    return draftConnectors.map((c) => {
      const linked = credentialLinks[c.name];
      const linkedCred = linked ? credentials.find((cr) => cr.id === linked) : null;
      const matchedCred = linkedCred ?? matchCredentialToConnector(credentials, c.name);
      const hasCredential = c.has_credential || !!linked || !!matchedCred;
      return {
        name: c.name,
        health: hasCredential ? 'ready' as const : 'missing' as const,
        credentialName: matchedCred?.name ?? (linked ? linked : null),
        errorMessage: null,
      };
    });
  }, [draftConnectors, credentialLinks, credentials]);

  const readyConnectorCount = connectorRailItems.filter((c) => c.health === 'ready').length;

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
          {confirmResult && confirmResult.entityErrors.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.38 }}
              className="text-sm text-red-400/70 mb-2 space-y-1"
            >
              <div className="flex items-center gap-1.5 justify-center">
                <XCircle className="w-3 h-3" />
                <span>
                  {confirmResult.entityErrors.length} {confirmResult.entityErrors.length === 1 ? 'entity' : 'entities'} failed
                </span>
              </div>
              <div className="text-xs text-red-400/50 max-h-24 overflow-y-auto">
                {confirmResult.entityErrors.map((e, i) => (
                  <div key={i}>{e.entity_type} &lsquo;{e.entity_name}&rsquo;: {e.error}</div>
                ))}
              </div>
            </motion.div>
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

          {/* Entity summary grid — 6 cards, responsive */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-2 mb-4">
            <div className="px-2 py-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
              <Wrench className="w-3.5 h-3.5 text-blue-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{toolCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Tools</p>
            </div>
            <div className="px-2 py-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-center">
              <Zap className="w-3.5 h-3.5 text-amber-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{triggerCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Triggers</p>
            </div>
            <div className="px-2 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
              <Link className="w-3.5 h-3.5 text-emerald-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{connectorCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Connectors</p>
            </div>
            <div className="px-2 py-3 rounded-xl bg-rose-500/5 border border-rose-500/10 text-center">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{reviewCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Reviews</p>
            </div>
            <div className="px-2 py-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-center">
              <Brain className="w-3.5 h-3.5 text-cyan-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{memoryCount}</p>
              <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">Memory</p>
            </div>
            <div className="px-2 py-3 rounded-xl bg-orange-500/5 border border-orange-500/10 text-center">
              <Activity className="w-3.5 h-3.5 text-orange-400/60 mx-auto mb-1" />
              <p className="text-base font-semibold text-foreground/80 tabular-nums">{eventCount}</p>
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
                  title={t.description ?? undefined}
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

          {/* Connector health rail */}
          {connectorRailItems.length > 0 && (
            <div className="rounded-xl border border-primary/10 bg-secondary/15 overflow-hidden mb-2" data-testid="connector-health-rail">
              {/* Summary bar */}
              <div className="flex items-center gap-3 px-3.5 py-2.5 bg-secondary/25 border-b border-primary/[0.06]" data-testid="connector-health-summary">
                <span className="text-sm text-muted-foreground/80">
                  <span className={`font-semibold ${readyConnectorCount === connectorRailItems.length ? 'text-emerald-400' : readyConnectorCount > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {readyConnectorCount}
                  </span>
                  {' '}of {connectorRailItems.length} connector{connectorRailItems.length !== 1 ? 's' : ''} ready
                </span>
                <div className="flex-1 h-1 rounded-full bg-primary/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                    style={{ width: connectorRailItems.length > 0 ? `${(readyConnectorCount / connectorRailItems.length) * 100}%` : '0%' }}
                  />
                </div>
              </div>

              {/* Connector rows */}
              <div className="divide-y divide-primary/[0.06]">
                {connectorRailItems.map((item) => {
                  const dotColor = item.health === 'ready'
                    ? 'bg-emerald-400'
                    : item.health === 'failed'
                      ? 'bg-red-400'
                      : 'bg-amber-400';
                  const statusIcon = item.health === 'ready'
                    ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    : item.health === 'failed'
                      ? <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                      : <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />;
                  const translated = item.errorMessage
                    ? translateHealthcheckMessage(item.errorMessage)
                    : null;

                  return (
                    <div
                      key={item.name}
                      className="flex items-center gap-3 px-3.5 h-10"
                      data-testid={`connector-rail-row-${item.name}`}
                    >
                      {/* Status dot */}
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />

                      {/* Connector name */}
                      <span className="text-sm font-medium text-foreground/80 truncate min-w-0 flex-1">
                        {item.name}
                      </span>

                      {/* Credential name or missing label */}
                      {item.credentialName ? (
                        <span className="text-sm text-muted-foreground/60 truncate max-w-[140px]">
                          {item.credentialName}
                        </span>
                      ) : (
                        <span className="text-sm text-amber-400/70">No credential</span>
                      )}

                      {/* Status icon */}
                      {statusIcon}

                      {/* Error message for failed connectors */}
                      {translated && (
                        <span className="text-sm text-red-400/70 truncate max-w-[180px]" title={translated.raw}>
                          {translated.friendly}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
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
