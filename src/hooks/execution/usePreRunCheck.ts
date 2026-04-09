import { useMemo } from 'react';
import type { PersonaWithDetails, CredentialMetadata } from '@/lib/types/types';

export interface ToolReadiness {
  name: string;
  description: string | null;
  category: string | null;
  requiresCredential: string | null;
  credentialPresent: boolean;
}

export type ReadinessLevel = 'ready' | 'warnings' | 'blocked';

export interface PreRunCheck {
  level: ReadinessLevel;
  reasons: string[];
  model: string | null;
  tools: ToolReadiness[];
  toolCount: number;
  missingCredentials: string[];
  triggerCount: number;
  hasTriggers: boolean;
  maxBudgetUsd: number | null;
  maxTurns: number | null;
  timeoutMs: number;
  trustLevel: string;
}

/**
 * Gathers all pre-run readiness data for a persona.
 * Extends the readiness logic from PersonaEditorHeader with richer output.
 */
export function usePreRunCheck(
  persona: PersonaWithDetails | null,
  credentials: CredentialMetadata[],
): PreRunCheck {
  return useMemo(() => {
    if (!persona) {
      return {
        level: 'blocked',
        reasons: ['No agent selected'],
        model: null,
        tools: [],
        toolCount: 0,
        missingCredentials: [],
        triggerCount: 0,
        hasTriggers: false,
        maxBudgetUsd: null,
        maxTurns: null,
        timeoutMs: 0,
        trustLevel: 'manual',
      };
    }

    const credTypes = new Set(credentials.map((c) => c.service_type));
    const reasons: string[] = [];

    // Map tools with credential status
    const tools: ToolReadiness[] = (persona.tools || []).map((t) => ({
      name: t.name,
      description: t.description ?? null,
      category: t.category ?? null,
      requiresCredential: t.requires_credential_type ?? null,
      credentialPresent: !t.requires_credential_type || credTypes.has(t.requires_credential_type),
    }));

    // Missing credentials
    const missingCredentials = [
      ...new Set(
        tools
          .filter((t) => t.requiresCredential && !t.credentialPresent)
          .map((t) => t.requiresCredential!),
      ),
    ];

    if (missingCredentials.length > 0) {
      reasons.push(`Missing credentials: ${missingCredentials.join(', ')}`);
    }

    // Trigger status
    const triggerCount = (persona.triggers?.length ?? 0) + (persona.subscriptions?.length ?? 0);
    const hasTriggers = triggerCount > 0;

    // Determine readiness level
    let level: ReadinessLevel = 'ready';
    if (missingCredentials.length > 0) {
      level = 'warnings';
    }

    return {
      level,
      reasons,
      model: persona.model_profile ?? null,
      tools,
      toolCount: tools.length,
      missingCredentials,
      triggerCount,
      hasTriggers,
      maxBudgetUsd: persona.max_budget_usd ?? null,
      maxTurns: persona.max_turns ?? null,
      timeoutMs: persona.timeout_ms,
      trustLevel: persona.trust_level,
    };
  }, [persona, credentials]);
}
