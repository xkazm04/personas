import { useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { silentCatch } from "@/lib/silentCatch";
import { connectorCategoryTags } from "@/lib/credentials/builtinConnectors";
import type { CredentialMetadata, ConnectorDefinition, PersonaWithDetails } from '@/lib/types/types';

// Hex fallbacks for unknown / placeholder entries. Consumed by callers
// that pass `connectorColor` / `personaColor` into inline styles, so we
// keep raw hex values rather than Tailwind classes (mirrors dependencyGraph's
// NODE_COLOR convention). Tweak in one place if theme work touches these.
const FALLBACK_COLOR = {
  unknownConnector: '#8b5cf6',  // violet — connector with no catalog entry
  unknownPersona: '#3b82f6',    // blue   — persona with no `color` set
  placeholderPersona: '#6b7280', // gray   — global view's "any agent" row
} as const;

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

      // Check if a credential with matching service_type exists (auto-match).
      // Two paths:
      //  1. Direct: tool requires "github" → credential service_type is "github".
      //  2. Category: tool requires "source_control" (a category) → credential
      //     service_type is "github" which is tagged source_control. Templates
      //     authored at the category level (the common case for V3) need this
      //     second path; without it every category-shaped requirement renders
      //     as missing-credential even when a perfect candidate exists.
      const matching = credentials.filter((c) =>
        c.service_type === credType ||
        connectorCategoryTags(c.service_type).includes(credType),
      );

      const connector = connectorByName.get(credType);

      result.push({
        connectorName: credType,
        connectorLabel: connector?.label ?? credType,
        connectorColor: connector?.color ?? FALLBACK_COLOR.unknownConnector,
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
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const credentials = useVaultStore((s) => s.credentials);
  const connectors = useVaultStore((s) => s.connectorDefinitions);

  const target = persona ?? selectedPersona;

  return useMemo((): CredentialDemandSummary => {
    if (!target) return { totalDemands: 0, fulfilledCount: 0, unfulfilledCount: 0, reusableCount: 0, demands: [] };

    const personas = [{
      id: target.id,
      name: target.name,
      color: target.color ?? FALLBACK_COLOR.unknownPersona,
      tools: target.tools,
    }];

    // Parse credentialLinks from design_context
    const credentialLinks = new Map<string, Record<string, string>>();
    try {
      const ctx = target.design_context ? JSON.parse(target.design_context) : {};
      if (ctx.credentialLinks) credentialLinks.set(target.id, ctx.credentialLinks);
    } catch (err) {
      silentCatch("useUnfulfilledCredentials:design_context-parse")(err);
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
  const credentials = useVaultStore((s) => s.credentials);
  const connectors = useVaultStore((s) => s.connectorDefinitions);

  return useMemo((): CredentialDemandSummary => {
    // For the global view we approximate by matching the credential store's
    // service_types against the connector catalog. The actual demand detection
    // happens per-persona in the agent editor (see useUnfulfilledCredentials).
    // Global view shows: connectors with no matching credentials.

    const credServiceTypes = new Set<string>();
    for (const c of credentials) credServiceTypes.add(c.service_type);

    const uncoveredConnectors = connectors.filter((c) => !credServiceTypes.has(c.name));

    const demands: UnfulfilledCredential[] = uncoveredConnectors.map((c) => ({
      connectorName: c.name,
      connectorLabel: c.label,
      connectorColor: c.color,
      connectorCategory: c.category,
      personaId: '',
      personaName: 'Any agent using this connector',
      personaColor: FALLBACK_COLOR.placeholderPersona,
      matchingCredentials: [],
    }));

    return {
      totalDemands: connectors.length,
      fulfilledCount: connectors.length - uncoveredConnectors.length,
      unfulfilledCount: uncoveredConnectors.length,
      reusableCount: 0,
      demands,
    };
  }, [credentials, connectors]);
}
