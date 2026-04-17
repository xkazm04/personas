import { Wrench, Zap, Link, ChevronDown, ChevronRight, AlertTriangle, Brain, Activity, ShieldCheck } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useN8nDesignData } from '../../hooks/useN8nDesignData';
import { useResolvedEntities } from '../../hooks/useResolvedEntities';
import { countByType } from '../../edit/protocolParser';
import { matchCredentialToConnector } from '../../edit/connectorMatching';
import { buildConnectorRailItems } from '../../edit/connectorHealth';
import { useVaultStore } from "@/stores/vaultStore";
import { ENTITY_CARD_COLORS, TAG_COLORS, CAPABILITY_SPLIT_STYLES } from '../../colorTokens';
import type { ColorKey } from '../../colorTokens';
import { SuccessBanner } from './SuccessBanner';
import { ConnectorHealthRail } from './ConnectorHealthRail';
import type { ConfirmResult } from './n8nConfirmTypes';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);

  // Resolve entities via shared hook (draft-first, parser fallback)
  const resolved = useResolvedEntities(draft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames);

  const toolCount = resolved.tools.length;
  const triggerCount = resolved.triggers.length;
  const connectorCount = resolved.connectors.length;
  const { credentialLinks, capabilities } = useN8nDesignData(
    draft.design_context,
    draft.system_prompt,
    draft.structured_prompt as Record<string, unknown> | null,
  );
  const capCounts = useMemo(() => countByType(capabilities), [capabilities]);
  const reviewCount = capCounts.manual_review;
  const memoryCount = capCounts.agent_memory;
  const eventCount = capCounts.emit_event || triggerCount;

  // Tool-credential validation
  const credentials = useVaultStore((s) => s.credentials);
  const toolsNeedingCredentials = useMemo(() => {
    if (!resolved.hasDraftTools) return [];
    return resolved.tools.filter((tool) => {
      if (!tool.requires_credential_type) return false;
      const credType = tool.requires_credential_type;
      if (credentialLinks[credType]) return false;
      return !matchCredentialToConnector(credentials, credType);
    });
  }, [resolved.hasDraftTools, resolved.tools, credentialLinks, credentials]);

  const connectorRailItems = useMemo(
    () => buildConnectorRailItems(resolved.hasDraftConnectors ? resolved.connectors : null, credentialLinks, credentials),
    [resolved.hasDraftConnectors, resolved.connectors, credentialLinks, credentials],
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
        <div className="bg-secondary/20 border border-primary/10 rounded-modal p-4">
          <p className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
            Persona Preview
          </p>

          <div className="flex items-center gap-4 mb-4">
            <div
              className="animate-fade-scale-in w-14 h-14 rounded-modal flex items-center justify-center text-xl border shadow-elevation-3"
              style={{
                backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
                borderColor: `${draft.color ?? '#8b5cf6'}30`,
                boxShadow: `0 4px 24px ${draft.color ?? '#8b5cf6'}15`,
              }}
            >
              {draft.icon ?? '\u2728'}
            </div>
            <div>
              <p className="text-base font-semibold text-foreground/90">
                {draft.name ?? 'Unnamed Persona'}
              </p>
              <p className="text-sm text-foreground mt-0.5">
                {draft.description ?? 'No description provided'}
              </p>
            </div>
          </div>

          {/* Entity summary grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-3 mb-3">
            <EntityCard icon={Wrench} count={toolCount} label="Tools" color="blue" />
            <EntityCard icon={Zap} count={triggerCount} label="Triggers" color="amber" />
            <EntityCard icon={Link} count={connectorCount} label="Connectors" color="emerald" />
            <EntityCard icon={ShieldCheck} count={reviewCount} label="Reviews" color="rose" />
            <EntityCard icon={Brain} count={memoryCount} label="Memory" color="cyan" />
            <EntityCard icon={Activity} count={eventCount} label="Events" color="orange" />
          </div>

          {/* Items breakdown */}
          {resolved.tools.length > 0 && (
            resolved.hasDraftTools ? (
              <TagList items={resolved.tools.map((t) => ({ key: t.name, label: t.name, title: t.description }))} color="blue" />
            ) : (
              <TagList items={resolved.tools.map((t) => ({ key: t.name, label: t.name }))} color="blue" />
            )
          )}

          {resolved.triggers.length > 0 && (
            <TagList items={resolved.triggers.map((t, i) => ({ key: String(i), label: t.trigger_type, title: t.description ?? undefined }))} color="amber" />
          )}

          {/* Connector health rail */}
          <ConnectorHealthRail
            connectorRailItems={connectorRailItems}
            readyConnectorCount={readyConnectorCount}
          />

          {/* Protocol capability badges */}
          {capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {capabilities.map((cap) => {
                const style = CAPABILITY_SPLIT_STYLES[cap.type];
                return (
                  <span
                    key={cap.type}
                    className={`px-2 py-0.5 text-sm font-mono rounded border ${style ? `${style.bg} ${style.text}` : ''}`}
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
            <div className="flex items-start gap-2 p-3 rounded-modal bg-amber-500/5 border border-amber-500/15 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-400/70">
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
                className="flex items-center gap-2 text-sm text-foreground hover:text-muted-foreground transition-colors w-full"
              >
                {showPrompt ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>{t.templates.n8n.system_prompt_preview}</span>
              </button>
              {showPrompt && (
                <div
                  className="animate-fade-slide-in mt-2 p-3 rounded-card bg-background/40 border border-primary/10 overflow-hidden"
                >
                  <div className="text-sm max-h-48 overflow-y-auto leading-relaxed">
                    <MarkdownRenderer content={draft.system_prompt} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation hint */}
      {!created && (
        <p className="text-sm text-amber-300/70 text-center">
          Review the details above, then click "Confirm & Save Persona" to create.
        </p>
      )}
    </div>
  );
}

/* ---- Local helper components ---- */

function EntityCard({ icon: Icon, count, label, color }: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  color: ColorKey;
}) {
  return (
    <div className={`px-2 py-3 rounded-modal border text-center ${ENTITY_CARD_COLORS[color]}`}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
      <p className="text-base font-semibold text-foreground tabular-nums">{count}</p>
      <p className="text-sm text-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}


function TagList({ items, color }: {
  items: { key: string; label: string; title?: string }[];
  color: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 mb-3">
      {items.map((item) => (
        <span
          key={item.key}
          className={`px-2 py-0.5 text-sm font-mono rounded border ${TAG_COLORS[color as ColorKey] ?? ''}`}
          title={item.title}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
