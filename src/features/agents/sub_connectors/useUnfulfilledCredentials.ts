import { useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { CredentialMetadata, ConnectorDefinition, PersonaWithDetails } from '@/lib/types/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnfulfilledCredential {
  connectorName: string;
  connectorLabel: string;
  connectorColor: string;
  connectorCategory: string;
  personaId: string;
  personaName: string;
  personaColor: string;
  matchingCredentials: CredentialMetadata[];
}

export interface CredentialDemandSummary {
  totalDemands: number;
  fulfilledCount: number;
  unfulfilledCount: number;
  reusableCount: number;
  demands: UnfulfilledCredential[];
}

// ---------------------------------------------------------------------------
// Core matching logic
// ---------------------------------------------------------------------------

function computeUnfulfilled(
  personas: { id: string; name: string; color: string; tools: { requires_credential_type: string | null }[] }[],
  credentials: CredentialMetadata[],
  connectors: ConnectorDefinition[],
  credentialLinks: Map<string, Record<string, string>>,
): UnfulfilledCredential[] {
  const connectorByName = new Map<string, ConnectorDefinition>();
  for (const c of connectors) connectorByName.set(c.name, c);

  const result: UnfulfilledCredential[] = [];

  for (const persona of personas) {
    const requiredTypes = new Set<string>();
    for (const tool of persona.tools) {
      if (tool.requires_credential_type) requiredTypes.add(tool.requires_credential_type);
    }

    const links = credentialLinks.get(persona.id) ?? {};

    for (const credType of requiredTypes) {
      // Check if already linked via design_context
      const linkedCredId = links[credType];
      if (linkedCredId && credentials.some((c) => c.id === linkedCredId)) continue;

      // Check if a credential with matching service_type exists (auto-match)
      const matching = credentials.filter((c) => c.service_type === credType);

      const connector = connectorByName.get(credType);

      result.push({
        connectorName: credType,
        connectorLabel: connector?.label ?? credType,
        connectorColor: connector?.color ?? '#8b5cf6',
        connectorCategory: connector?.category ?? 'unknown',
        personaId: persona.id,
        personaName: persona.name,
        personaColor: persona.color,
        matchingCredentials: matching,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hook: unfulfilled credentials for the selected persona
// ---------------------------------------------------------------------------

export function useUnfulfilledCredentials(persona?: PersonaWithDetails | null) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectors = usePersonaStore((s) => s.connectorDefinitions);

  const target = persona ?? selectedPersona;

  return useMemo((): CredentialDemandSummary => {
    if (!target) return { totalDemands: 0, fulfilledCount: 0, unfulfilledCount: 0, reusableCount: 0, demands: [] };

    const personas = [{
      id: target.id,
      name: target.name,
      color: target.color ?? '#3b82f6',
      tools: target.tools,
    }];

    // Parse credentialLinks from design_context
    const credentialLinks = new Map<string, Record<string, string>>();
    try {
      const ctx = target.design_context ? JSON.parse(target.design_context) : {};
      if (ctx.credentialLinks) credentialLinks.set(target.id, ctx.credentialLinks);
    } catch {
      // intentional: non-critical — design_context may not be valid JSON
    }

    const demands = computeUnfulfilled(personas, credentials, connectors, credentialLinks);

    const requiredTypes = new Set<string>();
    for (const tool of target.tools) {
      if (tool.requires_credential_type) requiredTypes.add(tool.requires_credential_type);
    }
    const totalDemands = requiredTypes.size;
    const unfulfilledCount = demands.length;
    const fulfilledCount = totalDemands - unfulfilledCount;
    const reusableCount = demands.filter((d) => d.matchingCredentials.length > 0).length;

    return { totalDemands, fulfilledCount, unfulfilledCount, reusableCount, demands };
  }, [target, credentials, connectors]);
}

// ---------------------------------------------------------------------------
// Hook: global unfulfilled credentials across all personas
// ---------------------------------------------------------------------------

export function useGlobalUnfulfilledCredentials() {
  const personas = usePersonaStore((s) => s.personas);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectors = usePersonaStore((s) => s.connectorDefinitions);

  return useMemo((): CredentialDemandSummary => {
    // DbPersona doesn't have tools directly — we'd need PersonaWithDetails for each.
    // For the global view, we approximate by matching personas' design_context credentialLinks
    // against the credential store. This is a lighter query since we don't fetch full details.
    // The actual demand detection happens per-persona in the agent editor.
    // Global view shows: credentials that exist but are unused, and connectors with no credentials.

    const allConnectorNames = new Set<string>();
    for (const c of connectors) allConnectorNames.add(c.name);

    const credServiceTypes = new Set<string>();
    for (const c of credentials) credServiceTypes.add(c.service_type);

    // Connectors with no matching credentials
    const uncoveredConnectors = connectors.filter((c) => !credServiceTypes.has(c.name));

    const demands: UnfulfilledCredential[] = uncoveredConnectors.map((c) => ({
      connectorName: c.name,
      connectorLabel: c.label,
      connectorColor: c.color,
      connectorCategory: c.category,
      personaId: '',
      personaName: 'Any agent using this connector',
      personaColor: '#6b7280',
      matchingCredentials: [],
    }));

    return {
      totalDemands: connectors.length,
      fulfilledCount: connectors.length - uncoveredConnectors.length,
      unfulfilledCount: uncoveredConnectors.length,
      reusableCount: 0,
      demands,
    };
  }, [personas, credentials, connectors]);
}
