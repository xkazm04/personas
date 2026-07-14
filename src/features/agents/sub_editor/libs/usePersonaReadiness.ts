import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';

export interface PersonaReadiness {
  /** True when the persona has no blocking reasons and may be enabled. */
  canEnable: boolean;
  /** Human-readable, translated blocking reasons (empty when ready). */
  reasons: string[];
  /** Count of DISTINCT credential types the persona's tools require but the
   *  vault doesn't yet hold. Drives the Design-tab missing-connector badge. */
  missingConnectorCount: number;
}

/**
 * Single readiness resolver for a persona, derived from `selectedPersona.tools`
 * × vault credentials (plus trigger/subscription presence).
 *
 * This is the ONE place the editor computes readiness — the header popover and
 * the Design-tab badge both consume it, so the "why can't I enable this" reason
 * list and the badge count can never drift apart. Memoized on the underlying
 * store slices so neither consumer churns on unrelated renders.
 */
export function usePersonaReadiness(): PersonaReadiness {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const credentials = useVaultStore((s) => s.credentials);

  const triggers = selectedPersona?.triggers;
  const subscriptions = selectedPersona?.subscriptions;
  const tools = selectedPersona?.tools;

  return useMemo(() => {
    if (!selectedPersona) {
      return { canEnable: false, reasons: [] as string[], missingConnectorCount: 0 };
    }
    const reasons: string[] = [];
    if (!(triggers || []).length && !(subscriptions || []).length) {
      reasons.push(t.agents.editor_ui.no_triggers_or_subs);
    }
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = (tools || [])
      .filter((tl) => tl.requires_credential_type && !credTypes.has(tl.requires_credential_type))
      .map((tl) => tl.requires_credential_type!);
    const unique = [...new Set(missingCreds)];
    if (unique.length > 0) {
      reasons.push(tx(t.agents.editor_ui.missing_credentials, { credentials: unique.join(', ') }));
    }
    return { canEnable: reasons.length === 0, reasons, missingConnectorCount: unique.length };
  }, [selectedPersona, triggers, subscriptions, tools, credentials, t, tx]);
}
