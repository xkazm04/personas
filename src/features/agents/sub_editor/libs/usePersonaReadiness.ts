import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignSubTab, EditorTab } from '@/lib/types/types';

/**
 * One reason the persona cannot be enabled, carried with the surface that
 * fixes it. The blocker is the unit the header renders, so the sentence and
 * the destination can never drift apart - a reason with no destination would
 * be the static-text popover this replaced.
 */
export interface ReadinessBlocker {
  /** Stable identifier - what is missing, independent of the translated copy. */
  id: 'no_triggers_or_subs' | 'missing_credentials';
  /** Human-readable, translated sentence. */
  message: string;
  /** Editor tab that owns the fix. */
  fixTab: EditorTab;
  /** Design hub sub-tab that owns the fix, when `fixTab` is the hub. */
  fixSubTab?: DesignSubTab;
}

export interface PersonaReadiness {
  /** True when the persona has no blocking reasons and may be enabled. */
  canEnable: boolean;
  /** Blocking reasons, each carrying the surface that fixes it (empty when ready). */
  blockers: ReadinessBlocker[];
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
      return {
        canEnable: false,
        blockers: [] as ReadinessBlocker[],
        reasons: [] as string[],
        missingConnectorCount: 0,
      };
    }
    const blockers: ReadinessBlocker[] = [];
    if (!(triggers || []).length && !(subscriptions || []).length) {
      blockers.push({
        id: 'no_triggers_or_subs',
        message: t.agents.editor_ui.no_triggers_or_subs,
        fixTab: 'design',
        fixSubTab: 'responsibilities',
      });
    }
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const missingCreds = (tools || [])
      .filter((tl) => tl.requires_credential_type && !credTypes.has(tl.requires_credential_type))
      .map((tl) => tl.requires_credential_type!);
    const unique = [...new Set(missingCreds)];
    if (unique.length > 0) {
      blockers.push({
        id: 'missing_credentials',
        message: tx(t.agents.editor_ui.missing_credentials, { credentials: unique.join(', ') }),
        fixTab: 'design',
        fixSubTab: 'connectors',
      });
    }
    return {
      canEnable: blockers.length === 0,
      blockers,
      reasons: blockers.map((b) => b.message),
      missingConnectorCount: unique.length,
    };
  }, [selectedPersona, triggers, subscriptions, tools, credentials, t, tx]);
}
