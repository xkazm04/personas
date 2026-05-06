import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the toast store so we can assert exactly when the persistence
// failure toast fires without spinning up the global app shell.
vi.mock("@/stores/toastStore", () => {
  const addToast = vi.fn();
  return {
    useToastStore: { getState: () => ({ addToast }) },
    __addToastSpy: addToast,
  };
});

// We need to access the spy after mocking. Vitest hoists `vi.mock` so the
// import below always resolves to the mocked module.
import * as toastStoreModule from "@/stores/toastStore";

import {
  createTourSlice,
  type TourSlice,
  type TourId,
} from "./tourSlice";
import type { SystemStore } from "../../storeTypes";

const STORAGE_KEY = "guided-tour-state";

// Reset all global persistence state between tests. Without this, the
// probe result persists across tests via globalThis (the production
// behavior we want at runtime — but isolated per-test in a unit suite).
function resetGlobals() {
  globalThis.__personasTourStorageProbed = undefined;
  globalThis.__personasTourStorageAvailable = undefined;
  globalThis.__personasTourStorageToastShown = undefined;
}

// Minimal Zustand-style harness: matches the pattern used in
// networkSlice.test.ts. We don't need any other slice for these tests
// since startTour only reads/writes the tour-prefixed fields.
function makeHarness() {
  let state = {} as SystemStore;
  const set = (
    partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>),
  ) => {
    const patch =
      typeof partial === "function"
        ? (partial as (s: SystemStore) => Partial<SystemStore>)(state)
        : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createTourSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return { state: () => state, slice: () => state as unknown as TourSlice };
}

// Seed the underlying localStorage with a v3 persisted state. The
// version constant is internal; we copy it here because if it changes
// the behavior under test changes too, and that should fail loudly.
function seedPersistedTour(
  tourId: TourId,
  patch: Partial<{
    completed: boolean;
    dismissed: boolean;
    currentStepIndex: number;
    completedSteps: Record<string, boolean>;
    subStepIndex: number;
  }>,
) {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? {
    version: 3,
    tours: {},
  };
  existing.tours[tourId] = {
    completed: false,
    dismissed: false,
    currentStepIndex: 0,
    completedSteps: {},
    subStepIndex: 0,
    ...patch,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

describe("tourSlice tier-switch migration", () => {
  beforeEach(() => {
    localStorage.clear();
    resetGlobals();
  });

  it("migrates_completed_steps_when_switching_starter_to_power", () => {
    // Starter user has finished `appearance-setup` + `credentials-intro`
    // in the simplified tour and is half-way through.
    seedPersistedTour("getting-started-simple", {
      currentStepIndex: 2,
      subStepIndex: 1,
      completedSteps: {
        "appearance-setup": true,
        "credentials-intro": true,
      },
    });

    const h = makeHarness();
    // User upgrades — TourLauncher now picks "getting-started" and
    // calls startTour with the new id.
    h.slice().startTour("getting-started");

    const s = h.state();
    expect(s.tourActiveTourId).toBe("getting-started");
    // Shared step ids must carry over.
    expect(s.tourStepCompleted["appearance-setup"]).toBe(true);
    expect(s.tourStepCompleted["credentials-intro"]).toBe(true);
    // Cursor should land on the first unfinished shared step (or the
    // power-tour-only `persona-creation`, which is the next id).
    expect(s.tourStepCompleted["persona-creation"] ?? false).toBe(false);
    // `getting-started` index 0 = appearance-setup (done), 1 =
    // credentials-intro (done), 2 = persona-creation (next).
    expect(s.tourCurrentStepIndex).toBeGreaterThanOrEqual(2);

    // Persistence: the migrated state must be written back so a refresh
    // re-loads with the merged completion set.
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(persisted?.tours["getting-started"].completedSteps["appearance-setup"]).toBe(true);
    expect(persisted?.tours["getting-started"].completedSteps["credentials-intro"]).toBe(true);
    // Symmetric requirement: the partner's record is left intact, so
    // a downgrade later does not lose the user's original work.
    expect(persisted?.tours["getting-started-simple"].completedSteps["appearance-setup"]).toBe(true);
  });

  it("migration_is_symmetric_power_to_starter", () => {
    seedPersistedTour("getting-started", {
      completedSteps: { "appearance-setup": true, "persona-creation": true },
    });
    const h = makeHarness();
    h.slice().startTour("getting-started-simple");
    expect(h.state().tourStepCompleted["appearance-setup"]).toBe(true);
    expect(h.state().tourStepCompleted["persona-creation"]).toBe(true);
  });

  it("migration_does_not_overwrite_existing_target_progress", () => {
    // User had progress in the simple tour. Then they switched to
    // power, made progress there too. Now they switch back to simple.
    seedPersistedTour("getting-started-simple", {
      completedSteps: { "credentials-intro": true },
    });
    seedPersistedTour("getting-started", {
      completedSteps: { "appearance-setup": true },
    });
    const h = makeHarness();
    h.slice().startTour("getting-started-simple");
    // Both should be set: the prior simple progress AND the migrated
    // step from power.
    expect(h.state().tourStepCompleted["credentials-intro"]).toBe(true);
    expect(h.state().tourStepCompleted["appearance-setup"]).toBe(true);
  });

  it("non_partner_tour_switch_does_not_mutate_completion", () => {
    seedPersistedTour("getting-started", {
      completedSteps: { "appearance-setup": true, "credentials-intro": true },
    });
    const h = makeHarness();
    // execution-observability is NOT a tier partner — its step ids do
    // not overlap with getting-started, so no migration should happen.
    h.slice().startTour("execution-observability");
    expect(h.state().tourActiveTourId).toBe("execution-observability");
    expect(h.state().tourStepCompleted["appearance-setup"] ?? false).toBe(false);
    expect(h.state().tourStepCompleted["credentials-intro"] ?? false).toBe(false);
  });
});

describe("tourSlice storage probe", () => {
  beforeEach(() => {
    localStorage.clear();
    resetGlobals();
    vi.clearAllMocks();
  });

  it("clean_localStorage_passes_probe_silently", () => {
    makeHarness();
    // Probe ran during slice construction. Should not have toasted.
    const addToast = (toastStoreModule as unknown as { __addToastSpy: ReturnType<typeof vi.fn> }).__addToastSpy;
    expect(addToast).not.toHaveBeenCalled();
    expect(globalThis.__personasTourStorageAvailable).toBe(true);
  });

  it("setItem_throw_at_boot_disables_persistence_and_toasts_once", () => {
    // Simulate Safari private mode / quota exceeded: setItem throws.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    });

    try {
      makeHarness();
      const addToast = (toastStoreModule as unknown as { __addToastSpy: ReturnType<typeof vi.fn> }).__addToastSpy;
      expect(addToast).toHaveBeenCalledTimes(1);
      // Toast type must be "error" — not silent, not success.
      expect(addToast.mock.calls[0]?.[1]).toBe("error");
      expect(globalThis.__personasTourStorageAvailable).toBe(false);

      // A second slice creation in the same session must not double-toast.
      makeHarness();
      expect(addToast).toHaveBeenCalledTimes(1);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("persistState_is_no_op_when_storage_unavailable", () => {
    // Boot probe fails.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("SecurityError");
    });
    try {
      const h = makeHarness();
      const setItemSpy = Storage.prototype.setItem as ReturnType<typeof vi.fn>;
      const callsBefore = setItemSpy.mock.calls.length;

      // startTour calls persistState internally — must not retry the
      // localStorage write that we already know will throw.
      h.slice().startTour("getting-started");
      const callsAfter = setItemSpy.mock.calls.length;
      // No new setItem calls past the probe attempts.
      expect(callsAfter).toBe(callsBefore);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("in_memory_tour_state_still_works_when_storage_unavailable", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("NS_ERROR_FILE_CORRUPTED");
    });
    try {
      const h = makeHarness();
      h.slice().startTour("getting-started");
      // Tour is usable in this session — only the persistence is
      // disabled. The `tourActive` flag and step state behave normally.
      expect(h.state().tourActive).toBe(true);
      expect(h.state().tourActiveTourId).toBe("getting-started");
      h.slice().completeTourStep("appearance-setup");
      expect(h.state().tourStepCompleted["appearance-setup"]).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
