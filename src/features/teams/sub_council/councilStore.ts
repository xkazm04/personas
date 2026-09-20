// The Council page's one store.
//
// Shape follows the FEATURE-LOCAL convention its neighbour already sets
// (`sub_mastermind/lib/sceneStore.ts`: a plain `create<T>()`, one `…Status`
// field per data family, `silentCatch` in every catch) rather than the
// `src/stores/slices/` slice pattern, which exists to compose ONE root store
// out of many slices. This page is not part of that root store and adding it
// would widen `OverviewStore` for a surface nothing else reads.
//
// The invariant the whole page rests on: `focus` lives HERE. The canvas, the
// docked list and the breadcrumb all read it — never three components with
// their own idea of "where am I", which is the defect the reference artifact
// calls out by name.
import { create } from 'zustand';

import { getCouncilOverlay, getRegistryGalaxy, listCouncilSubjects } from '@/api/devTools/council';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { CouncilOverlay } from '@/lib/bindings/CouncilOverlay';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';
import { silentCatch } from '@/lib/silentCatch';

import { buildLayout } from './galaxy/engine/layout';
import { FIXTURE_ROOT, IS_DEV, loadReferenceFixture } from './galaxy/fixture';
import type { CameraState, GalaxyCounts, GalaxyFocus, GalaxyLayout, GalaxyNode } from './galaxy/engine/types';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

interface WarmEntry {
  galaxy: RegistryGalaxy;
  overlay: CouncilOverlay | null;
  subjects: CouncilSubjectState[];
}

/**
 * A lazy route unmounts on nav-away, so the next visit would re-ghost a
 * 471-star field it already had. Keyed by registry root (a machine can hold
 * more than one paired checkout), with a named cap rather than a hand-rolled
 * Map that grows for the life of the process.
 */
const warm = createModuleCache<string, WarmEntry>({ ttlMs: 5 * 60_000, maxSize: 4 });

export interface CouncilStore {
  // ── the galaxy ──
  /** Null until a registry is paired: UNPAIRED is a state, not an empty field. */
  registryRoot: string | null;
  galaxy: RegistryGalaxy | null;
  overlay: CouncilOverlay | null;
  layout: GalaxyLayout | null;
  galaxyStatus: LoadStatus;
  /** The error VALUE. Resolution to human copy happens at the render edge. */
  galaxyError: unknown;

  // ── the councils ──
  subjects: CouncilSubjectState[];
  subjectsStatus: LoadStatus;
  subjectsError: unknown;

  // ── where the reader is ──
  focus: GalaxyFocus;
  counts: GalaxyCounts;
  hover: GalaxyNode | null;
  filter: string;
  selectedIndex: number;
  lensOn: boolean;
  /** The view to restore when the bench drops (WP8 raises it). */
  cameraBeforeBench: CameraState | null;

  /** DEV only: the page is showing the checked-in reference fixture. */
  fixtureOn: boolean;

  load: (registryRoot: string | null) => Promise<void>;
  loadFixture: () => Promise<void>;
  setFocus: (focus: GalaxyFocus) => void;
  focusCouncil: (subject: CouncilSubjectState, camera: CameraState | null) => void;
  clearCouncilFocus: () => void;
  setCounts: (counts: GalaxyCounts) => void;
  setHover: (node: GalaxyNode | null) => void;
  setFilter: (filter: string) => void;
  setSelectedIndex: (index: number) => void;
  setLens: (on: boolean) => void;
  setCameraBeforeBench: (camera: CameraState | null) => void;
}

const EMPTY_COUNTS: GalaxyCounts = {
  altitude: 'sky',
  shown: 0,
  lit: 0,
  dimmed: 0,
  labelsHidden: 0,
};

function adopt(entry: WarmEntry) {
  return {
    galaxy: entry.galaxy,
    overlay: entry.overlay,
    subjects: entry.subjects,
    layout: buildLayout(entry.galaxy, entry.overlay),
    galaxyStatus: 'loaded' as const,
    subjectsStatus: 'loaded' as const,
    galaxyError: null,
    subjectsError: null,
  };
}

export const useCouncilStore = create<CouncilStore>((set, get) => ({
  registryRoot: null,
  galaxy: null,
  overlay: null,
  layout: null,
  galaxyStatus: 'idle',
  galaxyError: null,

  subjects: [],
  subjectsStatus: 'idle',
  subjectsError: null,

  focus: { kind: 'none' },
  counts: EMPTY_COUNTS,
  hover: null,
  filter: '',
  selectedIndex: 0,
  lensOn: true,
  cameraBeforeBench: null,
  fixtureOn: false,

  loadFixture: async () => {
    if (!IS_DEV) return;
    set({ galaxyStatus: 'loading', subjectsStatus: 'loading', galaxyError: null });
    try {
      const bundle = await loadReferenceFixture();
      set({ registryRoot: FIXTURE_ROOT, fixtureOn: true, focus: { kind: 'none' }, ...adopt(bundle) });
    } catch (e) {
      silentCatch('councilStore.fixture')(e);
      set({ galaxyStatus: 'failed', galaxyError: e });
    }
  },

  load: async (registryRoot) => {
    set({ registryRoot, fixtureOn: false });
    if (!registryRoot) {
      set({ galaxyStatus: 'idle', galaxy: null, layout: null, galaxyError: null });
      return;
    }
    const cached = warm.get(registryRoot);
    if (cached) set(adopt(cached));
    else set({ galaxyStatus: 'loading', subjectsStatus: 'loading', galaxyError: null, subjectsError: null });

    // The three reads are independent: a council store with no rows must not
    // stop the galaxy from painting, and vice versa.
    const [galaxyResult, overlayResult, subjectsResult] = await Promise.allSettled([
      getRegistryGalaxy(registryRoot),
      getCouncilOverlay(),
      listCouncilSubjects(),
    ]);

    if (get().registryRoot !== registryRoot) return;

    const overlay = overlayResult.status === 'fulfilled' ? overlayResult.value : null;
    if (overlayResult.status === 'rejected') silentCatch('councilStore.overlay')(overlayResult.reason);

    if (subjectsResult.status === 'fulfilled') {
      set({ subjects: subjectsResult.value, subjectsStatus: 'loaded', subjectsError: null });
    } else {
      silentCatch('councilStore.subjects')(subjectsResult.reason);
      set({ subjectsStatus: 'failed', subjectsError: subjectsResult.reason });
    }

    if (galaxyResult.status === 'fulfilled') {
      const galaxy = galaxyResult.value;
      warm.set(registryRoot, {
        galaxy,
        overlay,
        subjects: subjectsResult.status === 'fulfilled' ? subjectsResult.value : [],
      });
      set({
        galaxy,
        overlay,
        layout: buildLayout(galaxy, overlay),
        galaxyStatus: 'loaded',
        galaxyError: null,
      });
      return;
    }
    silentCatch('councilStore.galaxy')(galaxyResult.reason);
    // A read failure is an inline error with a retry, never an empty galaxy —
    // and never the warm copy relabelled as fresh.
    set({ galaxyStatus: 'failed', galaxyError: galaxyResult.reason });
  },

  setFocus: (focus) => set({ focus, selectedIndex: 0, filter: '' }),

  focusCouncil: (subject, camera) =>
    set((s) => ({
      cameraBeforeBench: camera ?? s.cameraBeforeBench,
      selectedIndex: 0,
      filter: '',
      focus: {
        kind: 'council',
        subjectId: subject.id,
        title: subject.title,
        registrySubjects: subject.registrySubjects,
      },
    })),

  clearCouncilFocus: () => set({ focus: { kind: 'none' }, selectedIndex: 0, filter: '' }),
  setCounts: (counts) => set({ counts }),
  setHover: (hover) => set({ hover }),
  setFilter: (filter) => set({ filter, selectedIndex: 0 }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setLens: (lensOn) => set({ lensOn }),
  setCameraBeforeBench: (cameraBeforeBench) => set({ cameraBeforeBench }),
}));

/** Test hatch: the warm cache outlives every component that reads it. */
export function resetCouncilWarmCache(): void {
  warm.invalidateAll();
}
