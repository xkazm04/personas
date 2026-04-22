import { useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { GlyphGrid } from '@/features/shared/glyph';
import {
  buildChronology,
  buildFlowLookup,
} from '@/features/templates/sub_generated/adoption/chronology/useUseCaseChronology';
import EmptyState from '@/features/shared/components/feedback/EmptyState';

/** View-mode rendering of the Glyph capability grid.
 *
 *  Reads the saved persona's `last_design_result` (the AgentIR JSON produced
 *  at build-time), parses it, and feeds the shared `<GlyphGrid>`. Same UI as
 *  adoption / edit mode, just a different data source. */
export function PersonaUseCasesTabGlyph() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);

  const { rows, flowsById } = useMemo(() => {
    const ir = parseDesignResult(selectedPersona?.last_design_result ?? null);
    return {
      rows: buildChronology(ir),
      flowsById: buildFlowLookup(ir),
    };
  }, [selectedPersona?.last_design_result]);

  if (!selectedPersona) {
    return <EmptyState title="No persona selected" description="Pick a persona from the sidebar." />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pb-6">
        <GlyphGrid
          rows={rows}
          flowsById={flowsById}
          templateName={selectedPersona.name}
          emptyLabel="This persona has no v3 capability data — switch to the grid view."
        />
      </div>
    </div>
  );
}

function parseDesignResult(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
