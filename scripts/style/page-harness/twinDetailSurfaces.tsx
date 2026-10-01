/**
 * The integrated Twin Detail page and the training overlay (spark
 * twin-portable-blueprint, WP6), mounted through the real `TwinPage` route on
 * the synthetic tapes in `twinDetailTapes.mjs`. Unlike `twin/blueprint/*`
 * (fixture models straight into a variant), every number here comes through
 * the page's own reads. `?kit=<variant>` picks the blueprint variant the way
 * the Detail page's switcher persists it (default `drafting`).
 *
 *   twin/detail         the `setup` tab: header, CTAs, switcher, the blueprint at L1
 *   twin/stage          the overlay on the training stage over that page; the surface
 *                       plays the live card (Enter on the table), so the hand lifts and
 *                       the blueprint shows the scored answer while the deep pass runs
 *   twin/stage-dealt    the same overlay with the live card dealt over the blueprint
 *
 * Usage: node scripts/style/shoot.mjs --module twin/detail --tape synthetic --out docs/design/twin-blueprint --label detail
 */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { safeLocalSet } from '@/lib/safeLocalStorage';
import type { HarnessModule } from './registry';

const VARIANTS = ['drafting', 'draftingTint', 'draftingSurface', 'draftingNative', 'strata'];
/** `blueprintVariant.ts` VARIANT_KEY: the switcher's persisted pick. */
const VARIANT_KEY = 'twin-blueprint-variant';

function pickVariant(): void {
  const kit = new URLSearchParams(window.location.search).get('kit') ?? '';
  safeLocalSet(VARIANT_KEY, VARIANTS.includes(kit) ? kit : 'drafting', 'page-harness:twin-variant');
}

async function prepare(): Promise<void> {
  pickVariant();
  // The app holds the roster before anyone reaches the tab (the footer's twin
  // selector reads it at boot); without it TwinPage bounces an empty roster to
  // Profiles on its first render. Tones, channels and memories arrive through
  // the page's own fetches, from the tape.
  await useSystemStore.getState().fetchTwinProfiles({ force: true });
  useSystemStore.setState({ sidebarSection: 'plugins', twinTab: 'setup' });
}

/**
 * Opens the overlay once the page has mounted (after StrictMode's double effect,
 * whose cleanup would close a request opened earlier), then, with `play`,
 * answers the live card with Enter on the table once both the card and the
 * blueprint are there.
 */
function OpenTheTable({ play, children }: { play: boolean; children: ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const tick = () => {
      if (cancelled || !play) return;
      const desk = document.querySelector<HTMLElement>('[data-testid="setup-desk"]');
      const card = document.querySelector('[data-testid="setup-desk-question"]');
      // The blueprint is drawn once its stage holds something other than the ghost.
      const stage = document.querySelector('[data-testid="twin-blueprint-stage"]');
      const drawn = !!stage && stage.childElementCount > 0 && !stage.querySelector('[data-testid="twin-blueprint-ghost"]');
      if (desk && card && drawn) {
        desk.focus();
        desk.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return;
      }
      if (tries++ < 120) later(tick, 50);
    };
    later(() => {
      void import('@/features/plugins/twin/experience/launcher').then(({ openTwinExperience }) => {
        if (!cancelled) openTwinExperience({ mode: 'train', stage: 'training' });
      });
    }, 80);
    later(tick, 500);
    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [play]);
  return <>{children}</>;
}

function twinPage(wrap?: (page: ReactNode) => ReactNode) {
  return async (): Promise<{ default: ComponentType }> => {
    const { default: TwinPage } = await import('@/features/plugins/twin/TwinPage');
    return {
      default: function TwinRoute() {
        const page = (
          <div className="h-full w-full flex flex-col min-h-0">
            <TwinPage />
          </div>
        );
        return <>{wrap ? wrap(page) : page}</>;
      },
    };
  };
}

export const TWIN_DETAIL_MODULES: Record<string, HarnessModule> = {
  'twin/detail': { load: twinPage(), prepare },
  'twin/stage': { load: twinPage((page) => <OpenTheTable play>{page}</OpenTheTable>), prepare },
  'twin/stage-dealt': { load: twinPage((page) => <OpenTheTable play={false}>{page}</OpenTheTable>), prepare },
};
