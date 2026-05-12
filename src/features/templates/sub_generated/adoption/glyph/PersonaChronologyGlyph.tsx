import { memo, useCallback, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { GlyphGrid } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import { useUseCaseChronology, useUseCaseFlows } from '../chronology/useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from '../chronology/ChronologyCommandHub';

type Props = ChronologyCommandHubProps;

const BUILDING_PHASES: ReadonlySet<NonNullable<Props['buildPhase']>> = new Set([
  'initializing', 'analyzing', 'resolving', 'awaiting_input', 'testing',
]);

/** Adoption-time capability view. Reads the current `buildDraft` through
 *  `useUseCaseChronology()` and feeds the shared `<GlyphGrid>`. The command
 *  hub at the top carries lifecycle controls (test / approve / promote).
 *
 *  Phase D — interactive matrix glyphs:
 *  Each use-case card's sigil exposes per-dimension panels with a "refine
 *  this dimension" textbox. Submitted refinements are routed through the
 *  same `onRefine` channel as the draft-ready refine panel, but prefixed
 *  with the use-case + dimension context so the build engine knows what
 *  to target. While a build is in progress, petal clicks are no-ops; the
 *  start-test button is relabeled "Rebuild & Test" while pending
 *  refinements haven't yet been re-tested. */
function PersonaChronologyGlyphImpl(props: Props) {
  const rows = useUseCaseChronology();
  const flowsById = useUseCaseFlows();
  const templateName = useAgentStore((s) => {
    const draft = s.buildDraft as Record<string, unknown> | null;
    const name = draft?.name;
    return typeof name === 'string' ? name : undefined;
  });

  // Tracks whether the user has issued at least one dimension-level
  // refinement since the last test run. Drives the "Rebuild & Test" label
  // on the command hub's primary CTA. Reset on every Start Test click.
  const [pendingRebuild, setPendingRebuild] = useState(false);

  const isBuilding = !!props.buildPhase && BUILDING_PHASES.has(props.buildPhase);

  const handleRefineDimension = useCallback(
    (useCaseId: string, dim: GlyphDimension, feedback: string) => {
      if (!props.onRefine) return;
      const row = rows.find((r) => r.id === useCaseId);
      const useCaseLabel = row?.title ?? useCaseId;
      const message = `Refine the ${dim} for use case "${useCaseLabel}": ${feedback}`;
      props.onRefine(message);
      setPendingRebuild(true);
    },
    [props, rows],
  );

  const wrappedOnStartTest = useCallback(() => {
    setPendingRebuild(false);
    props.onStartTest?.();
  }, [props]);

  // The command hub sees onStartTest indirectly; we pass our wrapped one
  // so the pending-rebuild flag clears at the right moment. Other lifecycle
  // callbacks pass through unchanged.
  const hubProps: ChronologyCommandHubProps = {
    ...props,
    onStartTest: props.onStartTest ? wrappedOnStartTest : undefined,
    startTestLabelOverride: pendingRebuild ? 'Rebuild & Test' : undefined,
  };

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[640px] md:min-w-[800px] lg:min-w-[920px]">
      <ChronologyCommandHub {...hubProps} />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <GlyphGrid
          rows={rows}
          flowsById={flowsById}
          templateName={templateName}
          onRefineDimension={props.onRefine ? handleRefineDimension : undefined}
          isBuilding={isBuilding}
        />
      </div>
    </div>
  );
}

export const PersonaChronologyGlyph = memo(PersonaChronologyGlyphImpl);
