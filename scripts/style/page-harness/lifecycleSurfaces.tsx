/**
 * Teams > Lifecycle as the Lens (contest lifecycle-portfolio-r2, winner A/3):
 * the integrated LifecyclePage on the synthetic tapes in `lifecycleTapes.mjs`
 * and `lifecycleDetailTapes.mjs`. Every module but `portfolio` opens the Lens
 * on the tape's one project (as the Overseer's deep link does), so it shows
 * that project's columns; a step's detail (the last layer) is shot with
 * --steps "click=[data-testid=lens-col-<id>];click=[data-testid=lens-col-<id>];wait=600".
 * Real data: pass a recorded tape with --tape (never committed).
 *
 *   plugins/lifecycle/portfolio     the landing: three projects as the Lens portfolio
 *   plugins/lifecycle/collar        one project's columns
 *   plugins/lifecycle/empty         Layer 1 with no health rows and no goal
 *   plugins/lifecycle/detail        the project with every step's detail on the tape
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
 *   plugins/lifecycle/setup           never measured: the first-run setup over what detection found (wave 10)
 *   plugins/lifecycle/setup-none      never measured, detection found nothing: the setup's empty state
 *   plugins/lifecycle/perf            the collar under a React Profiler: every commit lands in
 *                                     `window.__LC_PROFILE__` and the live store is on
 *                                     `window.__LC_LIVE__` (scripts/style/lifecycle-perf.mjs)
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
import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { openLifecycleProject } from '@/features/plugins/dev-tools/sub_lifecycle/lifecycleView/lens/model/lensFocus';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

/** The tape's one project (lifecycleTapes.mjs, PROJECT). */
const PROJECT_ID = 'p-atlas';

/** The landing: the app has loaded its projects at boot; the Lens opens on the portfolio. */
async function preparePortfolio() {
  useSystemStore.setState({ sidebarSection: 'teams', teamsTab: 'lifecycle' });
  try {
    await useSystemStore.getState().fetchProjects();
  } catch (err) {
    console.warn('[page-harness] fetchProjects failed', err);
  }
}

/** One project: the Lens opened on it, as the Overseer's deep link does (never the app-wide active project). */
async function prepare() {
  await preparePortfolio();
  openLifecycleProject(PROJECT_ID);
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

/** One React commit, as the perf driver reads it. */
interface ProfileEntry { id: string; phase: string; actual: number; base: number; start: number; commit: number }

declare global {
  interface Window {
    __LC_PROFILE__?: ProfileEntry[];
    __LC_LIVE__?: typeof useDevToolsLiveStore;
    /** The recorder, for a nested <Profiler> added while investigating a cost. */
    __LC_RECORD__?: ProfilerOnRenderCallback;
  }
}

const record: ProfilerOnRenderCallback = (id, phase, actual, base, start, commit) => {
  (window.__LC_PROFILE__ ??= []).push({ id, phase, actual, base, start, commit });
};

/** The page under one Profiler, for scripts/style/lifecycle-perf.mjs. */
const profiledPage = () => page().then(({ default: Page }) => ({
  default: function ProfiledLifecycle() {
    return <Profiler id="lifecycle" onRender={record}><Page /></Profiler>;
  },
}));

async function preparePerf() {
  window.__LC_LIVE__ = useDevToolsLiveStore;
  window.__LC_RECORD__ = record;
  await prepare();
}

export const LIFECYCLE_MODULES: Record<string, HarnessModule> = {
  'plugins/lifecycle/portfolio': { load: page, prepare: preparePortfolio }, // the Lens landing (lifecycle-portfolio-r2)
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
  'plugins/lifecycle/setup': { load: page, prepare }, // wave 10: the first-run setup (lifecycleTapes.mjs)
  'plugins/lifecycle/setup-none': { load: page, prepare }, // wave 10: the first-run setup, nothing detected
  'plugins/lifecycle/perf': { load: profiledPage, prepare: preparePerf }, // wave 10: the collar under a Profiler (lifecycle-perf.mjs)
};
