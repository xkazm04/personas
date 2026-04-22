import { memo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { GlyphGrid } from '@/features/shared/glyph';
import { useUseCaseChronology, useUseCaseFlows } from '../chronology/useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from '../chronology/ChronologyCommandHub';

type Props = ChronologyCommandHubProps;

/** Adoption-time capability view. Reads the current `buildDraft` through
 *  `useUseCaseChronology()` and feeds the shared `<GlyphGrid>`. The command
 *  hub at the top carries lifecycle controls (test / approve / promote). */
function PersonaChronologyGlyphImpl(props: Props) {
  const rows = useUseCaseChronology();
  const flowsById = useUseCaseFlows();
  const templateName = useAgentStore((s) => {
    const draft = s.buildDraft as Record<string, unknown> | null;
    const name = draft?.name;
    return typeof name === 'string' ? name : undefined;
  });

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <ChronologyCommandHub {...props} />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <GlyphGrid rows={rows} flowsById={flowsById} templateName={templateName} />
      </div>
    </div>
  );
}

export const PersonaChronologyGlyph = memo(PersonaChronologyGlyphImpl);
