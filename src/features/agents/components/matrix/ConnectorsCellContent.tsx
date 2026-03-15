/**
 * Compact connector status list rendered inside the resolved "connectors" cell.
 *
 * Shows each connector with a status dot (green = credential linked, amber = missing)
 * and an inline "Link" button that opens a mini credential picker.
 */
import { useState } from "react";
import { Link2, ChevronDown } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { rankCredentialsForConnector } from "@/features/templates/sub_n8n/edit/connectorMatching";
import { MatrixCredentialPicker } from "./MatrixCredentialPicker";
import type { DraftConnector } from "./useMatrixCredentialGap";

interface ConnectorsCellContentProps {
  connectors: DraftConnector[];
}

export function ConnectorsCellContent({ connectors }: ConnectorsCellContentProps) {
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const buildConnectorLinks = useAgentStore((s) => s.buildConnectorLinks);
  const linkBuildConnector = useAgentStore((s) => s.linkBuildConnector);
  const credentials = useVaultStore((s) => s.credentials);

  return (
    <div className="space-y-1.5 w-full">
      {connectors.map((connector) => {
        const linkedCredId = buildConnectorLinks[connector.name];
        const hasCredential = connector.has_credential || !!linkedCredId;
        const isExpanded = expandedConnector === connector.name;

        // Get ranked credentials for the picker
        const { matching, others } = rankCredentialsForConnector(credentials ?? [], connector.name);

        return (
          <div key={connector.name} className="group">
            <div className="flex items-center gap-2 min-h-[28px]">
              {/* Status dot */}
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  hasCredential ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />

              {/* Connector name */}
              <span className="text-[12px] font-medium text-foreground/75 truncate flex-1 min-w-0">
                {connector.name}
              </span>

              {/* Link action */}
              {!hasCredential && (credentials ?? []).length > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors flex-shrink-0"
                  onClick={() => setExpandedConnector(isExpanded ? null : connector.name)}
                >
                  <Link2 className="w-3 h-3" />
                  <span>Link</span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-150 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {/* Linked indicator */}
              {hasCredential && (
                <span className="text-[10px] text-emerald-400/70 flex-shrink-0">Linked</span>
              )}
            </div>

            {/* Inline credential picker */}
            {isExpanded && (
              <MatrixCredentialPicker
                matchingCreds={matching}
                otherCreds={others}
                onSelect={(credentialId) => {
                  linkBuildConnector(connector.name, credentialId);
                  setExpandedConnector(null);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
