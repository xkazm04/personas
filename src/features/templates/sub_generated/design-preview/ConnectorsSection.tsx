import { useMemo } from 'react';
import { CheckCircle2, Plug, AlertCircle, ExternalLink, Wrench } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { DesignCheckbox } from './DesignCheckbox';
import { SECTION_LABEL } from './helpers';
import type { AgentIR, SuggestedConnector } from '@/lib/types/designTypes';
import type { PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

interface ConnectorsSectionProps {
  result: AgentIR;
  allToolDefs: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  selectedTools: Set<string>;
  onToolToggle: (toolName: string) => void;
  onConnectorClick?: (connector: SuggestedConnector) => void;
  readOnly: boolean;
}

export function ConnectorsSection({
  result,
  allToolDefs,
  currentToolNames,
  credentials,
  connectorDefinitions,
  selectedTools,
  onToolToggle,
  onConnectorClick,
  readOnly,
}: ConnectorsSectionProps) {
  const { t } = useTranslation();
  const credentialTypes = new Set(credentials.map((c) => c.service_type));
  const connectorNames = new Set(connectorDefinitions.map((c) => c.name));
  const suggestedConnectors = result.suggested_connectors ?? [];

  const suggestedTools = result.suggested_tools ?? [];

  const connectorToolMap = useMemo(() => {
    const linkedTools = new Set<string>();
    const map: Array<{ connector: SuggestedConnector; connDef: ConnectorDefinition | undefined; tools: string[] }> = [];

    for (const conn of suggestedConnectors) {
      const tools = (conn.related_tools ?? []).filter((t) => suggestedTools.includes(t));
      tools.forEach((t) => linkedTools.add(t));
      map.push({
        connector: conn,
        connDef: connectorDefinitions.find((c) => c.name === conn.name),
        tools,
      });
    }

    const unlinked = suggestedTools.filter((t) => !linkedTools.has(t));
    if (unlinked.length > 0) {
      map.push({ connector: { name: 'general' } as SuggestedConnector, connDef: undefined, tools: unlinked });
    }

    return map;
  }, [suggestedConnectors, connectorDefinitions, suggestedTools]);

  if (connectorToolMap.length === 0 && suggestedTools.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Plug className="w-4 h-4 text-emerald-400" />
        Connectors & Tools
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {connectorToolMap.map((item, idx) => {
          const isGeneral = item.connector.name === 'general';
          const installed = !isGeneral && connectorNames.has(item.connector.name);
          const hasCredential = !isGeneral && credentialTypes.has(item.connector.name);

          return (
            <div key={idx} className="bg-secondary/30 border border-primary/10 rounded-xl p-3.5 space-y-3">
              {/* Connector header */}
              <div className="flex items-center gap-2.5">
                {item.connDef?.icon_url ? (
                  <ThemedConnectorIcon url={item.connDef.icon_url} label={item.connDef.label} color={item.connDef.color} size="w-6 h-6 flex-shrink-0 rounded" />
                ) : isGeneral ? (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                    <Wrench className="w-3.5 h-3.5 text-muted-foreground/90" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                    <Plug className="w-3.5 h-3.5 text-muted-foreground/90" />
                  </div>
                )}
                <span className="text-sm font-medium text-foreground/80 flex-1 truncate">
                  {item.connDef?.label || (isGeneral ? 'General Tools' : item.connector.name)}
                </span>
                {!isGeneral && (
                  installed && hasCredential ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400/80 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400/80 flex-shrink-0" />
                  )
                )}
              </div>

              {/* Credential setup */}
              {!isGeneral && onConnectorClick && (item.connector.credential_fields?.length || item.connDef?.fields?.length) && (
                <button
                  type="button"
                  onClick={() => onConnectorClick(item.connector)}
                  className="flex items-center gap-1.5 text-sm text-primary/60 hover:text-primary transition-colors"
                >
                  {installed && hasCredential ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-amber-400" />
                  )}
                  <span>{installed && hasCredential ? t.templates.design.credential_ready : t.templates.design.configure_credential}</span>
                  {item.connector.setup_url && <ExternalLink className="w-3 h-3" />}
                </button>
              )}

              {/* Tools */}
              {item.tools.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-primary/[0.08]">
                  {item.tools.map((toolName) => {
                    const toolDef = allToolDefs.find((t) => t.name === toolName);
                    const isAlreadyAssigned = currentToolNames.includes(toolName);
                    const isSelected = selectedTools.has(toolName);

                    return (
                      <div key={toolName} className="flex items-center gap-2">
                        {!readOnly && (
                          <DesignCheckbox
                            checked={isSelected || isAlreadyAssigned}
                            disabled={isAlreadyAssigned}
                            onChange={() => onToolToggle(toolName)}
                          />
                        )}
                        <Wrench className="w-3 h-3 text-primary/40 flex-shrink-0" />
                        <span className="text-sm text-foreground/90 truncate">
                          {toolDef?.name || toolName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
