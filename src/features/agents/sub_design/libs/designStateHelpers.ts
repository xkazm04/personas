import { useMemo } from 'react';
import type { AgentIR } from '@/lib/types/designTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { PersonaWithDetails } from '@/lib/types/types';

// The five wizard hooks that lived beside this one (selection state, result
// sync, change summary, design-context sync, drift events) and the
// `DesignTabHelpers` module they leaned on went with the agent-manifest rebase
// (2026-09-04): their only mount point was the retired `DesignTab`, and a
// zero-consumer grep on 2026-09-04 confirmed nothing else imported them.

/**
 * Parsed saved design result with Google connector fixup.
 */
export function useSavedDesignResult(selectedPersona: PersonaWithDetails | null) {
  return useMemo<AgentIR | null>(() => {
    const parsed = parseJsonOrDefault<AgentIR | null>(selectedPersona?.last_design_result, null);
    if (!parsed) return null;
    const GOOGLE_CONNECTORS = new Set(['gmail', 'google_calendar', 'google_drive']);
    if (parsed.suggested_connectors) {
      return {
        ...parsed,
        suggested_connectors: parsed.suggested_connectors.map((c) =>
          !c.oauth_type && GOOGLE_CONNECTORS.has(c.name)
            ? { ...c, oauth_type: 'google' as const }
            : c
        ),
      };
    }
    return parsed;
  }, [selectedPersona?.last_design_result]);
}
