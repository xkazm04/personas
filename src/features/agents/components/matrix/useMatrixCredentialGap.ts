/**
 * Hook for credential gap analysis during the matrix build flow.
 *
 * Bridges the buildDraft (agent_ir) to the shared credential analysis utilities
 * from the n8n transform module. Returns gap analysis results and connector
 * health rail items for the UI.
 */
import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import {
  analyzeCredentialGaps,
  type CredentialGapResult,
} from "@/features/templates/sub_n8n/edit/credentialGapAnalysis";
import {
  buildConnectorRailItems,
  type ConnectorRailItem,
} from "@/features/templates/sub_n8n/edit/connectorHealth";
import type { SuggestedConnector } from "@/lib/types/designTypes";

/** Connector info extracted from build draft's required_connectors */
export interface DraftConnector {
  name: string;
  has_credential?: boolean;
}

interface UseMatrixCredentialGapReturn {
  /** Full gap analysis result (entries, counts) */
  gapResult: CredentialGapResult | null;
  /** Connector health rail items for UI display */
  connectorRailItems: ConnectorRailItem[];
  /** True when at least one required connector has no credential */
  hasCriticalGaps: boolean;
  /** Connectors extracted from the build draft */
  draftConnectors: DraftConnector[];
}

/**
 * Analyzes credential gaps for connectors in the build draft.
 * Returns null/empty when no connectors are in the draft.
 */
export function useMatrixCredentialGap(): UseMatrixCredentialGapReturn {
  const buildDraft = useAgentStore((s) => s.buildDraft);
  const buildConnectorLinks = useAgentStore((s) => s.buildConnectorLinks);
  const credentials = useVaultStore((s) => s.credentials);

  // Extract required_connectors from build draft
  const draftConnectors = useMemo<DraftConnector[]>(() => {
    if (!buildDraft || typeof buildDraft !== "object") return [];
    const ir = buildDraft as Record<string, unknown>;
    const connectors = ir.required_connectors;
    if (!Array.isArray(connectors)) return [];
    return connectors
      .filter(
        (c): c is Record<string, unknown> =>
          c != null && typeof c === "object" && typeof (c as Record<string, unknown>).name === "string",
      )
      .map((c) => ({
        name: c.name as string,
        has_credential: (c.has_credential as boolean) ?? false,
      }));
  }, [buildDraft]);

  // Convert draft connectors to SuggestedConnector shape for gap analysis
  const suggestedConnectors = useMemo<SuggestedConnector[]>(() =>
    draftConnectors.map((c) => ({ name: c.name })),
  [draftConnectors]);

  // Run gap analysis
  const gapResult = useMemo<CredentialGapResult | null>(() => {
    if (suggestedConnectors.length === 0 || !credentials) return null;
    return analyzeCredentialGaps(suggestedConnectors, credentials);
  }, [suggestedConnectors, credentials]);

  // Build connector rail items
  const connectorRailItems = useMemo<ConnectorRailItem[]>(() => {
    if (draftConnectors.length === 0 || !credentials) return [];

    const connectorInputs = draftConnectors.map((c) => ({
      name: c.name,
      has_credential: c.has_credential,
    }));

    return buildConnectorRailItems(connectorInputs, buildConnectorLinks, credentials);
  }, [draftConnectors, credentials, buildConnectorLinks]);

  const hasCriticalGaps = (gapResult?.missingCount ?? 0) > 0;

  return {
    gapResult,
    connectorRailItems,
    hasCriticalGaps,
    draftConnectors,
  };
}
