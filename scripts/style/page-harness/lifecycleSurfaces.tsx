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
 *   plugins/lifecycle/behind        Layer 1 measured 2 days ago, 14 commits behind (the header's warning)
 *   plugins/lifecycle/loading       the snapshot never answers: header chrome + the Layer-1 ghost
 *   plugins/lifecycle/regressed     Layer 1 one measure after a bad day: most steps worse than their earlier measure
 *   plugins/lifecycle/history-failed  the collar with the Measure history read failing (its inline banner)
 *   plugins/lifecycle/measuring       a Measure running: the header's live control, the panel, Gate and Tests measuring
 *   plugins/lifecycle/measuring-over  the same with the running command past 1.5x its median
 *   plugins/lifecycle/cancelling      the same with a cancel on its way
 *   plugins/lifecycle/measured        a Measure walked to its end while shot: the panel's summary
 *                                     (lifecycleMeasureTapes.mjs; `prepare` steps the revision twice)
 *   plugins/lifecycle/overseer-off    the collar with the Overseer switched off (lifecycleOverseerTapes.mjs)
 *   plugins/lifecycle/overseer-folded every Overseer item closed: his goal panel folded
 *
 * The collar's snapshot carries the Overseer's goal with every item state (wave 9); its Send
 * preview is shot with --steps "click=[data-testid=lc-overseer-send];wait=700".
 *
 * Every tape carries the Measure history (wave 3); time travel is shot with
 * --steps "click=[data-testid=lc-history-col-<i>];wait=600" (oldest = 0).
 *
 * WP4 retired the orbit and lane-board directions and their switcher, so
 * there is no stored variant to seed any more.
 */
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
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

/**
 * The `measured` tape replays three snapshots (collar, measuring, ended); a
 * `dev_lifecycle_*` change is what makes the page read the next one, so this
 * steps the revision as the backend's events would: the Measure starts, then ends.
 */
async function prepareMeasured() {
  await prepare();
  const step = () => useDevToolsLiveStore.getState().markLifecycleChanged();
  setTimeout(step, 900);
  setTimeout(step, 1800);
}

export const LIFECYCLE_MODULES: Record<string, HarnessModule> = {
  'plugins/lifecycle/collar': { load: page, prepare },
  'plugins/lifecycle/empty': { load: page, prepare },
  'plugins/lifecycle/detail': { load: page, prepare },
  'plugins/lifecycle/detail-nocov': { load: page, prepare },
  'plugins/lifecycle/behind': { load: page, prepare },
  'plugins/lifecycle/loading': { load: page, prepare },
  'plugins/lifecycle/regressed': { load: page, prepare },
  'plugins/lifecycle/history-failed': { load: page, prepare },
  'plugins/lifecycle/measuring': { load: page, prepare },
  'plugins/lifecycle/measuring-over': { load: page, prepare },
  'plugins/lifecycle/cancelling': { load: page, prepare },
  'plugins/lifecycle/measured': { load: page, prepare: prepareMeasured },
  'plugins/lifecycle/evidence': { load: page, prepare }, // wave 8: evidence steps tell the story of the practice (lifecycleEvidenceTapes.mjs)
  'plugins/lifecycle/docs': { load: page, prepare }, // wave 7: the Docs step as an estate (lifecycleDocsTapes.mjs)
  'plugins/lifecycle/gate': { load: page, prepare }, // wave 6: Gate and Tests as instruments, with run outputs (lifecycleGateTapes.mjs)
  'plugins/lifecycle/overseer-off': { load: page, prepare }, // wave 9: the Overseer switched off (lifecycleOverseerTapes.mjs)
  'plugins/lifecycle/overseer-folded': { load: page, prepare }, // wave 9: every Overseer item closed, the goal panel folded
};
