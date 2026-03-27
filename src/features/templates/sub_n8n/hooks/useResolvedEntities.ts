import { useMemo } from 'react';
import type { N8nPersonaDraft, N8nToolDraft, N8nTriggerDraft, N8nConnectorRef } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';

export interface ResolvedEntities {
  /** Draft tools if available, otherwise parser results mapped to DraftTool shape */
  tools: N8nToolDraft[];
  /** Draft triggers if available, otherwise selected parser triggers */
  triggers: N8nTriggerDraft[];
  /** Draft connectors if available, otherwise selected parser connectors mapped to ConnectorRef shape */
  connectors: N8nConnectorRef[];
  /** Whether the entities come from the draft (post-transform) vs parser fallback */
  hasDraftTools: boolean;
  hasDraftTriggers: boolean;
  hasDraftConnectors: boolean;
}

/**
 * Resolves entity lists by preferring draft entities (post-transform) and
 * falling back to parser results filtered by selection indices.
 *
 * This eliminates the duplicated resolution logic previously inlined in
 * N8nConfirmStep and N8nEntitiesTab.
 */
export function useResolvedEntities(
  draft: N8nPersonaDraft,
  parsedResult: AgentIR,
  selectedToolIndices: Set<number>,
  selectedTriggerIndices: Set<number>,
  selectedConnectorNames: Set<string>,
): ResolvedEntities {
  return useMemo(() => {
    const draftTools = draft.tools ?? null;
    const draftTriggers = draft.triggers ?? null;
    const draftConnectors = draft.required_connectors ?? null;

    // Fallback: filter parser results by selection indices
    const selectedTools = parsedResult.suggested_tools.filter((_, i) => selectedToolIndices.has(i));
    const selectedTriggers = parsedResult.suggested_triggers.filter((_, i) => selectedTriggerIndices.has(i));
    const selectedConnectors = (parsedResult.suggested_connectors ?? []).filter((c) =>
      selectedConnectorNames.has(c.name),
    );

    const tools: N8nToolDraft[] = draftTools ?? selectedTools.map((t) => ({ name: t, category: '', description: '' }));
    const triggers: N8nTriggerDraft[] = draftTriggers ?? selectedTriggers;
    const connectors: N8nConnectorRef[] = (draftConnectors && draftConnectors.length > 0)
      ? draftConnectors
      : selectedConnectors.map((c) => ({ name: c.name, n8n_credential_type: c.name, has_credential: false }));

    return {
      tools,
      triggers,
      connectors,
      hasDraftTools: draftTools !== null,
      hasDraftTriggers: draftTriggers !== null,
      hasDraftConnectors: draftConnectors !== null && draftConnectors.length > 0,
    };
  }, [draft.tools, draft.triggers, draft.required_connectors, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames]);
}
