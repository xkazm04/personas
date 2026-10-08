/**
 * Spark lifecycle-health: Teams > Lifecycle (the integrated LifecyclePage,
 * its own ContentBox / ContentHeader / ContentBody shell), on the synthetic
 * tapes in `lifecycleTapes.mjs` (Layer 1, WP3) and `lifecycleDetailTapes.mjs`
 * (Layer 2, WP4).
 *
 *   plugins/lifecycle/collar        Layer 1, the collar rail (the owner's pick)
 *   plugins/lifecycle/empty         Layer 1 with no health rows and no goal
 *   plugins/lifecycle/detail        Layer 1 with every step's detail on the tape;
 *                                   shoot a step with --steps "click=[data-testid=lc-node-<id>]"
 *   plugins/lifecycle/detail-nocov  the same with Tests' coverage unmeasured
 *
 * WP4 retired the orbit and lane-board directions and their switcher, so
 * there is no stored variant to seed any more.
 */
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

/** The tape's one project (lifecycleTapes.mjs, PROJECT). */
const PROJECT_ID = 'p-atlas';

async function prepare() {
  useSystemStore.setState({ sidebarSection: 'teams', teamsTab: 'lifecycle' });
  // The app loads projects at boot and remembers the active one; the page reads both.
  try {
    await useSystemStore.getState().fetchProjects();
  } catch (err) {
    console.warn('[page-harness] fetchProjects failed', err);
  }
  useSystemStore.setState({ activeProjectId: PROJECT_ID });
}

const page = () => import('@/features/plugins/dev-tools/sub_lifecycle/LifecyclePage');

export const LIFECYCLE_MODULES: Record<string, HarnessModule> = {
  'plugins/lifecycle/collar': { load: page, prepare },
  'plugins/lifecycle/empty': { load: page, prepare },
  'plugins/lifecycle/detail': { load: page, prepare },
  'plugins/lifecycle/detail-nocov': { load: page, prepare },
};
