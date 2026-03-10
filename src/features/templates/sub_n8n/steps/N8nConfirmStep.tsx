import { motion } from 'framer-motion';
import { Wrench, Zap, Link, ChevronDown, ChevronRight, AlertTriangle, Brain, Activity, ShieldCheck } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { extractProtocolCapabilities, countByType } from '../edit/protocolParser';
import { matchCredentialToConnector } from '../edit/connectorMatching';
import { buildConnectorRailItems } from '../edit/connectorHealth';
import { usePersonaStore } from '@/stores/personaStore';
import { SuccessBanner } from './SuccessBanner';
import { ConnectorHealthRail } from './ConnectorHealthRail';
import type { ConfirmResult } from './n8nConfirmTypes';

export type { EntityError, ConfirmResult } from './n8nConfirmTypes';

interface N8nConfirmStepProps {
  draft: N8nPersonaDraft;
  parsedResult: AgentIR;
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
      if (credentialLinks[credType]) return false;
      return !matchCredentialToConnector(credentials, credType);
    });
  }, [draftTools, credentialLinks, credentials]);

  const connectorRailItems = useMemo(
    () => buildConnectorRailItems(draftConnectors, credentialLinks, credentials),
    [draftConnectors, credentialLinks, credentials],
  );

  const readyConnectorCount = connectorRailItems.filter((c) => c.health === 'ready').length;

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {created && (
        <SuccessBanner
          personaName={draft.name ?? null}
          confirmResult={confirmResult}
          onReset={onReset}
        />
      )}

      {/* Persona preview card */}
      {!created && (
        <div className="bg-secondary/20 border border-primary/10 rounded-xl p-4">
          <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider mb-3">
            Persona Preview
          </p>

          <div className="flex items-center gap-4 mb-4">
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
              {draft.icon ?? '\u2728'}
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

          {/* Entity summary grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-2 mb-4">
            <EntityCard icon={Wrench} count={toolCount} label="Tools" color="blue" />
            <EntityCard icon={Zap} count={triggerCount} label="Triggers" color="amber" />
            <EntityCard icon={Link} count={connectorCount} label="Connectors" color="emerald" />
            <EntityCard icon={ShieldCheck} count={reviewCount} label="Reviews" color="rose" />
            <EntityCard icon={Brain} count={memoryCount} label="Memory" color="cyan" />
            <EntityCard icon={Activity} count={eventCount} label="Events" color="orange" />
          </div>

          {/* Items breakdown */}
          {draftTools && draftTools.length > 0 ? (
            <TagList items={draftTools.map((t) => ({ key: t.name, label: t.name, title: t.description }))} color="blue" />
          ) : selectedTools.length > 0 ? (
            <TagList items={selectedTools.map((t) => ({ key: t, label: t }))} color="blue" />
          ) : null}

          {draftTriggers && draftTriggers.length > 0 ? (
            <TagList items={draftTriggers.map((t, i) => ({ key: String(i), label: t.trigger_type, title: t.description ?? undefined }))} color="amber" />
          ) : selectedTriggers.length > 0 ? (
            <TagList items={selectedTriggers.map((t, i) => ({ key: String(i), label: t.trigger_type }))} color="amber" />
          ) : null}

          {/* Connector health rail */}
          <ConnectorHealthRail
            connectorRailItems={connectorRailItems}
            readyConnectorCount={readyConnectorCount}
          />

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

/* ---- Local helper components ---- */

type ColorKey = 'blue' | 'amber' | 'emerald' | 'rose' | 'cyan' | 'orange';

const colorMap: Record<ColorKey, string> = {
  blue: 'bg-blue-500/5 border-blue-500/10 text-blue-400/60',
  amber: 'bg-amber-500/5 border-amber-500/10 text-amber-400/60',
  emerald: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/60',
  rose: 'bg-rose-500/5 border-rose-500/10 text-rose-400/60',
  cyan: 'bg-cyan-500/5 border-cyan-500/10 text-cyan-400/60',
  orange: 'bg-orange-500/5 border-orange-500/10 text-orange-400/60',
};

function EntityCard({ icon: Icon, count, label, color }: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  color: ColorKey;
}) {
  return (
    <div className={`px-2 py-3 rounded-xl border text-center ${colorMap[color]}`}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
      <p className="text-base font-semibold text-foreground/80 tabular-nums">{count}</p>
      <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">{label}</p>
    </div>
  );
}

const tagColorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400/60 border-blue-500/15',
  amber: 'bg-amber-500/10 text-amber-400/60 border-amber-500/15',
};

function TagList({ items, color }: {
  items: { key: string; label: string; title?: string }[];
  color: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {items.map((item) => (
        <span
          key={item.key}
          className={`px-2 py-0.5 text-sm font-mono rounded border ${tagColorMap[color] ?? ''}`}
          title={item.title}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
