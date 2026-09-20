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
  /**
   * The focus the reader was standing in when the bench went up.
   *
   * The bench cannot reach the engine (GalaxyStage owns it and takes the
   * bench as an opaque node), so dropping the bench restores the FOCUS the
   * reader had rather than the exact camera: same altitude, same path, and
   * the engine flies there. Restoring the camera byte for byte needs the
   * engine handle; see the note in `docs/features/council.md`.
   */
  focusBeforeBench: GalaxyFocus | null;

  /** DEV only: the page is showing the checked-in reference fixture. */
  fixtureOn: boolean;

  // ── the bench (WP8) ──
  /** The queue drawer is up. The galaxy stays live above it, never hidden. */
  benchOpen: boolean;
  /** The subject whose round table is open. Null means the queue layer. */
  tableSubjectId: string | null;
  /** Index into the flattened queue; the arrows move this. */
  queueIndex: number;
  /**
   * Decisions taken with the fixture on.
   *
   * The fixture has no backend, so a decision has nowhere to go: it is held
   * here, the bench and the galaxy read it, and the page says out loud that
   * it is fixture mode. It is NEVER consulted when `fixtureOn` is false, so
   * a real decision can only ever come from the store.
   */
  fixtureDecisions: Record<string, { decision: 'approved' | 'rejected'; reason: string | null }>;
  /**
   * Bumped by the `G` key. The gate FOCUSES its Approve button when this
   * changes and does nothing else: no key in this app commits a decision.
   */
  gateFocusNonce: number;
  /**
   * `[` and `]` at the round table, as a signed step the table consumes.
   *
   * The chain of rounds lives in the table's own fetch, not here, so the key
   * handler cannot know which round is next - it says WHICH WAY, and the
   * table, which holds the chain, decides where that lands.
   */
  roundStep: number;

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

  setBenchOpen: (open: boolean) => void;
  setTableSubject: (subjectId: string | null) => void;
  setQueueIndex: (index: number) => void;
  /** Move the keyboard focus to the gate. It never commits. */
  focusGate: () => void;
  /** Ask the table for the previous (-1) or next (+1) round. */
  stepRound: (delta: number) => void;
  /** The table has honoured the step. */
  clearRoundStep: () => void;
  /** Re-read the councils and the overlay after a decision lands. */
  refreshCouncils: () => Promise<void>;
  /** Fixture mode only: hold the decision in memory so the page can show it. */
  recordFixtureDecision: (
    subjectId: string,
    decision: 'approved' | 'rejected',
    reason: string | null,
  ) => void;
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
  focusBeforeBench: null,
  fixtureOn: false,
  benchOpen: false,
  tableSubjectId: null,
  queueIndex: 0,
  fixtureDecisions: {},
  gateFocusNonce: 0,
  roundStep: 0,

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

  setBenchOpen: (benchOpen) =>
    set((s) =>
      benchOpen
        ? { benchOpen, focusBeforeBench: s.focus }
        : {
            benchOpen,
            tableSubjectId: null,
            focus: s.focusBeforeBench ?? { kind: 'none' },
            focusBeforeBench: null,
          },
    ),
  setTableSubject: (tableSubjectId) => set({ tableSubjectId }),
  setQueueIndex: (queueIndex) => set({ queueIndex }),
  focusGate: () => set((s) => ({ gateFocusNonce: s.gateFocusNonce + 1 })),
  stepRound: (delta) => set({ roundStep: delta }),
  clearRoundStep: () => set({ roundStep: 0 }),

  recordFixtureDecision: (subjectId, decision, reason) =>
    set((s) => {
      if (!s.fixtureOn) return s;
      return { fixtureDecisions: { ...s.fixtureDecisions, [subjectId]: { decision, reason } } };
    }),

  refreshCouncils: async () => {
    // The fixture has no backend to re-read; its decisions live in the store
    // and the page already re-rendered from them.
    if (get().fixtureOn) return;
    const root = get().registryRoot;
    const [subjectsResult, overlayResult] = await Promise.allSettled([
      listCouncilSubjects(),
      getCouncilOverlay(),
    ]);
    if (subjectsResult.status === 'fulfilled') {
      set({ subjects: subjectsResult.value, subjectsStatus: 'loaded', subjectsError: null });
    } else {
      silentCatch('councilStore.refresh.subjects')(subjectsResult.reason);
    }
    if (overlayResult.status === 'rejected') {
      silentCatch('councilStore.refresh.overlay')(overlayResult.reason);
      return;
    }
    const overlay = overlayResult.value;
    const galaxy = get().galaxy;
    // The stars have to repaint: a decision changes the marks the field is
    // drawn with, and a bench that agreed with a sky that did not would be
    // two ideas of the same fact.
    if (galaxy) set({ overlay, layout: buildLayout(galaxy, overlay) });
    if (root) {
      const cached = warm.get(root);
      if (cached) {
        warm.set(root, {
          ...cached,
          overlay,
          subjects: subjectsResult.status === 'fulfilled' ? subjectsResult.value : cached.subjects,
        });
      }
    }
  },
}));

/** Test hatch: the warm cache outlives every component that reads it. */
export function resetCouncilWarmCache(): void {
  warm.invalidateAll();
}
