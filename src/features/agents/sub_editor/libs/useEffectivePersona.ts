import { useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import type { PersonaDraft } from './PersonaDraft';
import type { PersonaWithDetails } from '@/lib/types/types';

/**
 * Returns a merged read-only view of the current persona where draft
 * values override persisted store values for display fields (name, description,
 * icon, color, enabled).  Structural fields (tools, triggers, subscriptions,
 * timestamps, etc.) remain authoritative from the store.
 *
 * This eliminates the dual-source-of-truth where PersonaEditorHeader would
 * show stale store values while PersonaSettingsTab showed live draft values.
 */
export function useEffectivePersona(
  draft: PersonaDraft,
  baseline: PersonaDraft,
): PersonaWithDetails | null {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);

  return useMemo(() => {
    if (!selectedPersona) return null;

    return {
      ...selectedPersona,
      // Override display fields with draft when they have been edited
      name: draft.name !== baseline.name ? draft.name : selectedPersona.name,
      description:
        draft.description !== baseline.description
          ? (draft.description || null)
          : selectedPersona.description,
      icon: draft.icon !== baseline.icon ? (draft.icon || null) : selectedPersona.icon,
      color: draft.color !== baseline.color ? (draft.color || null) : selectedPersona.color,
      enabled: draft.enabled !== baseline.enabled ? draft.enabled : selectedPersona.enabled,
    };
  }, [selectedPersona, draft, baseline]);
}
