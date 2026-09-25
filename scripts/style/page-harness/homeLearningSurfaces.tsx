/**
 * Home > Learning (`home/sub_learning`, kit batch home-1): the Learning Center HomePage mounts
 * in a keep-alive pane for tab `learning` (HomePage.tsx), in the same pane class, on the
 * synthetic tapes in `homeLearningTapes.mjs`.
 *
 *   home/learning         a returning user: 3 tours done, 1 in progress, 2 playable composed
 *                         tours and 1 outdated one, 4 power moves used
 *   home/learning/fresh   first run: nothing started, Athena has composed nothing yet
 *   home/learning/failed  the composed-tours fetch rejects (retry band), returning-user progress
 *   home/learning/tour    the returning user with the in-progress tour's detail opened
 *
 * Progress lives in two client stores (the tour store, hydrated from localStorage, and the
 * persisted power-moves store); `prepare` writes them the way a real session leaves them.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const IN_PROGRESS = 'execution-observability';
const DONE = ['getting-started', 'getting-started-simple', 'templates-recipes'];
const USED = ['monitor-triage', 'credential-health', 'lab-measure', 'event-chain'];

async function prepareLearning(returning: boolean): Promise<void> {
  useSystemStore.setState({ sidebarSection: 'home', homeTab: 'learning' });
  const [{ useTourStore }, { getActiveTourSteps }, { usePowerMovesStore }] = await Promise.all([
    import('@/stores/tourStore'),
    import('@/stores/slices/system/tourSlice'),
    import('@/features/home/sub_learning/powerMoves/powerMovesStore'),
  ]);
  if (!returning) return;
  const stepCompleted: Record<string, boolean> = {};
  for (const s of getActiveTourSteps(IN_PROGRESS as never).slice(0, 2)) stepCompleted[s.id] = true;
  useTourStore.setState({
    tourStepCompleted: stepCompleted as never,
    tourCompletionMap: Object.fromEntries(DONE.map((id) => [id, true])) as never,
  });
  usePowerMovesStore.setState({ tried: Object.fromEntries(USED.map((id) => [id, true])) as Record<string, true> });
}

/** Clicks `selector` once it exists (polled for up to 5 s). Guarded against StrictMode's double effect. */
function ClickWhenReady({ selector, children }: { selector: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || root.dataset.driven) return;
    root.dataset.driven = '1';
    let tries = 0;
    const tick = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) { el.click(); return; }
      if (tries++ < 100) setTimeout(tick, 50);
    };
    tick();
  }, [selector]);
  return <div ref={ref} className="contents">{children}</div>;
}

function inHomePane(click?: string) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: Page } = await import('@/features/home/sub_learning/HomeLearning');
    return {
      default: function HomeLearningHost() {
        // The keep-alive pane HomePage gives an active tab (PANE_CLASS, minus its entrance animation).
        const page = (
          <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
              <Page />
            </div>
          </div>
        );
        return click ? <ClickWhenReady selector={click}>{page}</ClickWhenReady> : page;
      },
    };
  };
}

export const HOME_LEARNING_MODULES: Record<string, HarnessModule> = {
  'home/learning': { load: inHomePane(), prepare: () => prepareLearning(true) },
  'home/learning/fresh': { load: inHomePane(), prepare: () => prepareLearning(false) },
  'home/learning/failed': { load: inHomePane(), prepare: () => prepareLearning(true) },
  'home/learning/tour': {
    // The tour's card carries the test id and its title is the one button (the kit ContextCard);
    // before batch home-1 the whole card was the button and carried the id itself.
    load: inHomePane(`[data-testid="learning-tour-${IN_PROGRESS}"] button, button[data-testid="learning-tour-${IN_PROGRESS}"]`),
    prepare: () => prepareLearning(true),
  },
};
