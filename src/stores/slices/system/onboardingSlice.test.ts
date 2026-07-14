import { describe, it, expect, beforeEach } from "vitest";

import { createOnboardingSlice, type OnboardingSlice } from "./onboardingSlice";
import type { SystemStore } from "../../storeTypes";

const STORAGE_KEY = "onboarding-state-v1";

// Minimal Zustand-style harness (mirrors tourSlice.test.ts). The reopen /
// resume paths under test read and write only onboarding-prefixed fields, so
// no other slice is needed. `startOnboarding` is intentionally NOT exercised
// here — it depends on the storeBus persona accessor.
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
  const slice = createOnboardingSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return {
    state: () => state as unknown as OnboardingSlice,
    set,
  };
}

describe("onboardingSlice — reversible skip escape hatch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("resumeOnboarding — dismissed mid-flow", () => {
    it("reactivates at the recorded step and clears the dismissed marker", () => {
      const h = makeHarness();
      // Simulate a dismiss at the 'pick-template' step.
      h.set({ onboardingDismissedAtStep: "pick-template", onboardingCompleted: false });

      h.state().resumeOnboarding();

      expect(h.state().onboardingActive).toBe(true);
      expect(h.state().onboardingStep).toBe("pick-template");
      expect(h.state().onboardingDismissedAtStep).toBeNull();
    });

    it("is a no-op when nothing was dismissed", () => {
      const h = makeHarness();
      h.set({ onboardingDismissedAtStep: null, onboardingCompleted: false, onboardingActive: false });

      h.state().resumeOnboarding();

      expect(h.state().onboardingActive).toBe(false);
    });

    it("is a no-op once onboarding has completed (reopen owns that case)", () => {
      const h = makeHarness();
      h.set({ onboardingDismissedAtStep: "adopt", onboardingCompleted: true, onboardingActive: false });

      h.state().resumeOnboarding();

      // Completed users must go through reopenOnboarding (from the top), not resume.
      expect(h.state().onboardingActive).toBe(false);
      expect(h.state().onboardingStep).not.toBe("adopt");
    });
  });

  describe("reopenOnboarding — completed / skipped", () => {
    it("restarts from the top and clears the completed flag + persistence", () => {
      const h = makeHarness();
      h.set({ onboardingCompleted: true, onboardingStep: "execute" });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed: true, dismissedAtStep: null }));

      h.state().reopenOnboarding();

      expect(h.state().onboardingActive).toBe(true);
      expect(h.state().onboardingCompleted).toBe(false);
      expect(h.state().onboardingStep).toBe("appearance");
      expect(h.state().onboardingStepCompleted.execute).toBe(false);

      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      expect(persisted).toEqual({ completed: false, dismissedAtStep: null });
    });
  });

  describe("dismiss → resume round-trip preserves the step", () => {
    it("records the step on dismiss and returns to it on resume", () => {
      const h = makeHarness();
      h.set({ onboardingActive: true, onboardingStep: "discover", onboardingCompleted: false });

      h.state().dismissOnboarding();
      expect(h.state().onboardingActive).toBe(false);
      expect(h.state().onboardingDismissedAtStep).toBe("discover");

      h.state().resumeOnboarding();
      expect(h.state().onboardingActive).toBe(true);
      expect(h.state().onboardingStep).toBe("discover");
      expect(h.state().onboardingDismissedAtStep).toBeNull();
    });
  });
});
