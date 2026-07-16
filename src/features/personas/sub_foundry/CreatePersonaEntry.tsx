import { Suspense } from 'react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { lazyRetry } from '@/lib/lazyRetry';

// lazyRetry, not raw lazy: raw lazy caches a rejected chunk import forever
// (the 2026-06-07 "bricked section" incident) — one failed fetch would brick
// the create flow until a full reload, defeating the outer ErrorBoundary
// retry that PersonasPage's lazyRetry declarations exist to make work.
const UnifiedBuildEntry = lazyRetry(() =>
  import('@/features/agents/components/matrix/UnifiedBuildEntry').then((m) => ({ default: m.UnifiedBuildEntry })),
);

/**
 * The persona-creation surface — a single flow for every tier.
 *
 * The retired "Compose" (Foundry) wizard folded its one genuinely-useful idea —
 * foundation selection (mentality archetype + memory strategy) — into the
 * Describe surface's persona-core configurator (see `sub_glyph/personaCore`),
 * so creation is the intent surface (UnifiedBuildEntry): the LLM builds from a
 * description, with clarifying questions and a persona-core badge for the
 * temperament. The old two-tab strip (Describe / Browse templates) was
 * vestigial — the Describe tab was always active and inert, and the templates
 * gallery is reachable from the sidebar — so it collapsed to this single flow.
 */
export function CreatePersonaEntry() {
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="create-persona-entry">
      <Suspense fallback={<div className="flex items-center justify-center h-full"><LoadingSpinner /></div>}>
        <UnifiedBuildEntry />
      </Suspense>
    </div>
  );
}

export default CreatePersonaEntry;
