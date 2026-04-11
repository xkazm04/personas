/**
 * Interactive connector status list rendered inside the resolved "connectors" cell.
 *
 * Shows each connector with credential status and alternative swapping:
 * - Green dot + "Linked" = credential found
 * - Amber dot + "Link" button = credential available but not linked
 * - Red dot + "Add in Keys" = no matching credential exists
 * - Swap button = show alternative connectors the user can switch to
 */
import { useState, useMemo } from "react";
import { Link2, ChevronDown, KeyRound, ExternalLink, RefreshCw, ArrowLeftRight, Database, Plug } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { rankCredentialsForConnector, matchCredentialToConnector } from "@/features/templates/sub_n8n/edit/connectorMatching";
import { answerBuildQuestion } from "@/api/agents/buildSession";
import { MatrixCredentialPicker } from "./MatrixCredentialPicker";
import type { DraftConnector } from "./useMatrixCredentialGap";
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from "@/lib/log";

const logger = createLogger("connectors-cell");

interface ConnectorsCellContentProps {
  connectors: DraftConnector[];
}

export function ConnectorsCellContent({ connectors }: ConnectorsCellContentProps) {
  const { t, tx } = useTranslation();
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const [swappingConnector, setSwappingConnector] = useState<string | null>(null);
  const buildConnectorLinks = useAgentStore((s) => s.buildConnectorLinks);
  const linkBuildConnector = useAgentStore((s) => s.linkBuildConnector);
  const credentials = useVaultStore((s) => s.credentials);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const credList = credentials ?? [];
  const [hasChanges, setHasChanges] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Build a lookup map: lowercase connector name → ConnectorDefinition
  const connDefMap = useMemo(() => {
    const map = new Map<string, typeof connectorDefinitions[number]>();
    for (const def of connectorDefinitions) {
      map.set(def.name.toLowerCase(), def);
      map.set(def.label.toLowerCase(), def);
    }
    return map;
  }, [connectorDefinitions]);

  // Extract alternatives map from the connectors cell raw data
  const connectorsCellData = useAgentStore((s) => s.buildCellData["connectors"]);
  const alternatives = useMemo<Record<string, string[]>>(() => {
    const raw = connectorsCellData?.raw;
    if (!raw) return {};
    const alts = raw.alternatives;
    if (!alts || typeof alts !== 'object') return {};
    return alts as Record<string, string[]>;
  }, [connectorsCellData]);

  const handleSwapConnector = async (oldName: string, newName: string) => {
    const sessionId = useAgentStore.getState().buildSessionId;
    if (!sessionId) return;

    setRecalculating(true);
    setSwappingConnector(null);
    try {
      await answerBuildQuestion(
        sessionId,
        "_refine",
        `Swap connector "${oldName}" to "${newName}". Update all affected dimensions (tools, triggers, messages) to use ${newName} instead of ${oldName}. Resolve the updated connectors dimension and any affected dimensions.`,
      );
      setHasChanges(false);
    } catch (err) {
      logger.error("Swap failed", { error: err });
    }
    setRecalculating(false);
  };

  const handleRecalculate = async () => {
    const sessionId = useAgentStore.getState().buildSessionId;
    if (!sessionId) return;

    const links = useAgentStore.getState().buildConnectorLinks;
    const summary = connectors
      .map((c) => {
        const credId = links[c.name];
        const cred = credId ? credList.find((cr) => cr.id === credId) : matchCredentialToConnector(credList, c.name);
        return cred ? `${c.name}: using credential "${cred.name}"` : `${c.name}: no credential`;
      })
      .join('; ');

    setRecalculating(true);
    try {
      await answerBuildQuestion(sessionId, '_refine', `Connector credentials updated: ${summary}. Recalculate affected dimensions.`);
      setHasChanges(false);
    } catch (err) {
      logger.error('Recalculate failed', { error: err });
    }
    setRecalculating(false);
  };

  return (
    <div className="space-y-1 w-full">
      {connectors.map((connector) => {
        const linkedCredId = buildConnectorLinks[connector.name];
        const autoMatch = matchCredentialToConnector(credList, connector.name);
        const hasCredential = connector.has_credential || !!linkedCredId || !!autoMatch;
        const hasAnyCreds = credList.length > 0;
        const { matching, others } = rankCredentialsForConnector(credList, connector.name);
        const hasMatchingCreds = matching.length > 0 || others.length > 0;
        const credentialMissing = !hasCredential && !hasMatchingCreds;
        const isExpanded = expandedConnector === connector.name;
        const isSwapping = swappingConnector === connector.name;
        const connAlts = alternatives[connector.name.toLowerCase()] ?? [];

        // Real health check from credential metadata
        const matchedCred = linkedCredId
          ? credList.find((c) => c.id === linkedCredId)
          : autoMatch;
        const healthStatus = (matchedCred as Record<string, unknown> | undefined)?.healthcheck_last_success as boolean | null | undefined;
        const dotColor = !hasCredential && credentialMissing ? "bg-red-400"
          : !hasCredential ? "bg-amber-400"
          : healthStatus === true ? "bg-emerald-400"
          : healthStatus === false ? "bg-amber-400"
          : "bg-amber-400"; // untested

        // Look up connector definition for icon + category
        const connDef = connDefMap.get(connector.name.toLowerCase())
          || connDefMap.get(connector.name.replace(/[-_]/g, ' ').toLowerCase());
        const isDatabase = connDef?.category?.toLowerCase() === 'database'
          || connector.name.toLowerCase().includes('postgres')
          || connector.name.toLowerCase().includes('mysql')
          || connector.name.toLowerCase().includes('sqlite')
          || connector.name.toLowerCase().includes('mongo')
          || connector.name.toLowerCase().includes('redis')
          || connector.name.toLowerCase().includes('supabase');

        // Extract table name from raw cell data if available (for database connectors)
        const rawConnectors = connectorsCellData?.raw?.connectors;
        const rawEntry = Array.isArray(rawConnectors)
          ? (rawConnectors as Record<string, unknown>[]).find(
              (c) => (c.name as string)?.toLowerCase() === connector.name.toLowerCase()
            )
          : undefined;
        const tableName = rawEntry
          ? ((rawEntry.table_name ?? rawEntry.database_table ?? rawEntry.table ?? rawEntry.db_table) as string | undefined)
          : undefined;

        return (
          <div key={connector.name} className="group">
            <div className="flex items-center gap-2 min-h-[30px]">
              {/* Connector icon — from definition or fallback */}
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: colorWithAlpha(connDef?.color ?? '#6366f1', 0.13) }}
              >
                {connDef?.icon_url ? (
                  <img src={connDef.icon_url} alt="" className="w-3.5 h-3.5 object-contain" />
                ) : isDatabase ? (
                  <Database className="w-3 h-3" style={{ color: connDef?.color ?? '#6366f1' }} />
                ) : (
                  <Plug className="w-3 h-3" style={{ color: connDef?.color ?? '#6366f1' }} />
                )}
              </div>

              {/* Health status dot */}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />

              {/* Connector name */}
              <span className="text-[12px] font-medium text-foreground/75 truncate min-w-0">
                {connDef?.label ?? connector.name}
              </span>

              {/* Database table name badge */}
              {isDatabase && tableName && (
                <span className="text-[10px] text-muted-foreground/50 font-mono bg-secondary/30 px-1.5 py-0.5 rounded flex-shrink-0 truncate max-w-[120px]" title={tableName}>
                  {tableName}
                </span>
              )}

              <span className="flex-1" />

              {/* Swap button — shown when alternatives exist */}
              {connAlts.length > 0 && (
                <button
                  type="button"
                  className="flex-shrink-0 p-0.5 rounded text-foreground/30 hover:text-primary/70 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSwappingConnector(isSwapping ? null : connector.name);
                    setExpandedConnector(null);
                  }}
                  title={t.common.swap}
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>
              )}

              {/* Actions based on credential state + health */}
              {hasCredential ? (
                <span className={`text-[10px] flex-shrink-0 ${
                  healthStatus === true ? "text-emerald-400/70" :
                  healthStatus === false ? "text-amber-400/70" :
                  "text-amber-400/70"
                }`}>
                  {matchedCred ? matchedCred.name : t.agents.connectors_cell.linked}
                  {healthStatus === false && " ⚠"}
                </span>
              ) : credentialMissing ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 transition-colors flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSidebarSection('credentials');
                  }}
                >
                  <KeyRound className="w-3 h-3" />
                  <span>{t.agents.connectors_cell.add_in_keys}</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              ) : hasAnyCreds ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedConnector(isExpanded ? null : connector.name);
                    setSwappingConnector(null);
                  }}
                >
                  <Link2 className="w-3 h-3" />
                  <span>{t.agents.connectors_cell.link}</span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-150 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
              ) : null}
            </div>

            {/* Missing credential warning */}
            {credentialMissing && (
              <p className="text-[10px] text-red-400/50 pl-4 leading-tight">
                {tx(t.agents.connectors_cell.no_credential_found, { name: connector.name })}
              </p>
            )}

            {/* Inline credential picker */}
            {isExpanded && (
              <MatrixCredentialPicker
                matchingCreds={matching}
                otherCreds={others}
                onSelect={(credentialId) => {
                  linkBuildConnector(connector.name, credentialId);
                  setExpandedConnector(null);
                  setHasChanges(true);
                }}
              />
            )}

            {/* Alternative connector picker */}
            {isSwapping && connAlts.length > 0 && (
              <div className="ml-4 mt-1 space-y-0.5">
                <p className="text-[10px] text-foreground/40 mb-1">{t.agents.connectors_cell.swap_to}</p>
                {connAlts.map((alt) => (
                  <button
                    key={alt}
                    type="button"
                    disabled={recalculating}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] text-foreground/60 hover:bg-primary/10 hover:text-primary transition-colors text-left disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSwapConnector(connector.name, alt);
                    }}
                  >
                    <ArrowLeftRight className="w-3 h-3 flex-shrink-0" />
                    <span className="capitalize">{alt.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Recalculate button — shown when credentials change */}
      {hasChanges && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleRecalculate(); }}
          disabled={recalculating}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${recalculating ? 'animate-spin' : ''}`} />
          {recalculating ? t.agents.connectors_cell.recalculating : t.agents.connectors_cell.recalculate_dimensions}
        </button>
      )}

      {/* Recalculating overlay for swap operations */}
      {recalculating && !hasChanges && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-primary/60">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>{t.agents.connectors_cell.rebuilding}</span>
        </div>
      )}
    </div>
  );
}
