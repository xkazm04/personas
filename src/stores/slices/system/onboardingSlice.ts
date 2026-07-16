import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { TourId } from "./tourSlice";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/types/types";
import * as Sentry from "@sentry/react";
import { silentCatch } from '@/lib/silentCatch';


// -- Types --------------------------------------------------------------

export type OnboardingStep = "appearance" | "discover" | "pick-template" | "adopt" | "execute";

/** Canonical list of known onboarding steps — used to validate persisted state on hydrate. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "appearance",
  "discover",
  "pick-template",
  "adopt",
  "execute",
] as const;

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === "string" && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export interface OnboardingSlice {
  // State
  onboardingActive: boolean;
  onboardingStep: OnboardingStep;
  onboardingCompleted: boolean;
  onboardingStepCompleted: Record<OnboardingStep, boolean>;
  onboardingSelectedReviewId: string | null;
  onboardingCreatedPersonaId: string | null;
  /** Non-null when onboarding was dismissed mid-flow — stores the step where the user left off. */
  onboardingDismissedAtStep: OnboardingStep | null;
  /**
   * True once the one-time "take the guided tour" handoff has been shown after
   * a completed modal. Persisted so the offer NEVER re-appears — the modal and
   * the tour are two parallel first-runs; the handoff bridges them exactly once.
   */
  tourHandoffOffered: boolean;
  /** In-memory: the handoff offer card is currently on screen. */
  tourHandoffVisible: boolean;

  // Actions
  startOnboarding: () => void;
  resumeOnboarding: () => void;
  setOnboardingStep: (step: OnboardingStep) => void;
  completeOnboardingStep: (step: OnboardingStep) => void;
  setOnboardingSelectedReview: (reviewId: string | null) => void;
  setOnboardingCreatedPersona: (personaId: string | null) => void;
  /**
   * Mark onboarding as permanently completed (Done button at the end).
   * Sets `onboardingCompleted=true`; the flow does NOT auto-start again on
   * future launches. Use `reopenOnboarding()` to restart it manually.
   */
  finishOnboarding: () => void;
  /**
   * Dismiss the overlay for THIS session and remember where the user left
   * off (`onboardingDismissedAtStep`). Does NOT set `onboardingCompleted`,
   * so a returning user can call `resumeOnboarding()` to pick up where
   * they were. Dismiss is a deferral, not a permanent opt-out.
   */
  dismissOnboarding: () => void;
  /**
   * Manually re-open onboarding from a Help menu or similar affordance.
   * Works whether the user previously finished OR dismissed it — resets
   * the completion flag and step progress so the flow runs from scratch.
   * This is the escape hatch that makes Skip a reversible decision.
   */
  reopenOnboarding: () => void;
  /**
   * Show the one-time getting-started-tour offer. No-op if already offered, if
   * the modal didn't produce a first agent, or if the tour is already done.
   * Called from `finishOnboarding` — the modal-completion → tour handoff point.
   */
  offerTourHandoff: () => void;
  /**
   * Accept the handoff: hide the card and start the tour modal-aware. Because
   * the completed modal already created a live first agent, the tour's
   * "create your first agent" step is carried over as genuinely-done (honest
   * completion — the outcome the step checks is satisfied) rather than
   * re-taught. `tourId` is the tier-appropriate flavor (getting-started vs
   * getting-started-simple), chosen by the caller.
   */
  acceptTourHandoff: (tourId: TourId) => void;
  /** Decline the handoff: hide the card. The footer launcher still offers the tour. */
  dismissTourHandoff: () => void;
}

// -- Sentry metrics helper ----------------------------------------------

function trackMetric(name: string, attributes?: Record<string, string>) {
  try {
    Sentry.metrics.count(name, 1, attributes ? { attributes } : undefined);
  } catch (err) { silentCatch("stores/slices/system/onboardingSlice:catch1")(err); }
}

// -- Durable persistence (first-run completion survives reload/restart) -------
//
// Without this, onboardingCompleted / onboardingDismissedAtStep are in-memory
// only, so a Tauri webview reload or app restart mid- or post-onboarding loses
// them: a completed user can be re-prompted (the startOnboarding guard races
// fetchPersonas), and a dismissed user can never resumeOnboarding. Mirrors
// tourSlice's localStorage approach; try/catch-guarded so a failure degrades to
// in-memory (the old behavior) and never crashes.

const ONBOARDING_STORAGE_KEY = "onboarding-state-v1";

interface PersistedOnboarding {
  completed: boolean;
  dismissedAtStep: OnboardingStep | null;
  tourHandoffOffered: boolean;
}

function loadPersistedOnboarding(): PersistedOnboarding {
  const empty: PersistedOnboarding = { completed: false, dismissedAtStep: null, tourHandoffOffered: false };
  try {
    if (typeof localStorage === "undefined") return empty;
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedOnboarding>;
    return {
      completed: parsed.completed === true,
      dismissedAtStep: isOnboardingStep(parsed.dismissedAtStep) ? parsed.dismissedAtStep : null,
      tourHandoffOffered: parsed.tourHandoffOffered === true,
    };
  } catch (err) {
    silentCatch("stores/slices/system/onboardingSlice:load")(err);
    return empty;
  }
}

function persistOnboarding(next: PersistedOnboarding): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    silentCatch("stores/slices/system/onboardingSlice:persist")(err);
  }
}

// -- Slice --------------------------------------------------------------

const INITIAL_STEP_STATUS: Record<OnboardingStep, boolean> = {
  "appearance": false,
  "discover": false,
  "pick-template": false,
  "adopt": false,
  "execute": false,
};

export const createOnboardingSlice: StateCreator<
  SystemStore,
  [],
  [],
  OnboardingSlice
> = (set, get) => ({
  onboardingActive: false,
  onboardingStep: "discover",
  // Hydrated from localStorage so a reload/restart mid- or post-onboarding does
  // not reset first-run state (re-prompting a completed user / losing a dismissed
  // user's resume point). See loadPersistedOnboarding.
  onboardingCompleted: loadPersistedOnboarding().completed,
  onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
  onboardingSelectedReviewId: null,
  onboardingCreatedPersonaId: null,
  onboardingDismissedAtStep: loadPersistedOnboarding().dismissedAtStep,
  tourHandoffOffered: loadPersistedOnboarding().tourHandoffOffered,
  tourHandoffVisible: false,

  startOnboarding: () => {
    // Don't start if already completed or if user has personas already
    if (get().onboardingCompleted || storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS).length > 0) return;
    trackMetric("onboarding.started");
    set({
      onboardingActive: true,
      onboardingStep: "appearance",
      onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
      onboardingSelectedReviewId: null,
      onboardingCreatedPersonaId: null,
      onboardingDismissedAtStep: null,
    });
  },

  resumeOnboarding: () => {
    const { onboardingDismissedAtStep, onboardingCompleted } = get();
    if (onboardingCompleted || !onboardingDismissedAtStep) return;
    trackMetric("onboarding.resumed", { at_step: onboardingDismissedAtStep });
    set({
      onboardingActive: true,
      onboardingStep: onboardingDismissedAtStep,
      onboardingDismissedAtStep: null,
    });
  },

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboardingStep: (step) => {
    trackMetric("onboarding.step_completed", { step });
    set((state) => ({
      onboardingStepCompleted: {
        ...state.onboardingStepCompleted,
        [step]: true,
      },
    }));
  },

  setOnboardingSelectedReview: (reviewId) =>
    set({ onboardingSelectedReviewId: reviewId }),

  setOnboardingCreatedPersona: (personaId) =>
    set({ onboardingCreatedPersonaId: personaId }),

  finishOnboarding: () => {
    trackMetric("onboarding.flow_completed");
    set({
      onboardingActive: false,
      onboardingCompleted: true,
      onboardingStep: "appearance",
      onboardingDismissedAtStep: null,
    });
    persistOnboarding({ completed: true, dismissedAtStep: null, tourHandoffOffered: get().tourHandoffOffered });
    // The modal just completed with a live first agent — offer the guided tour
    // once so the two first-runs hand off instead of teaching agent creation
    // twice. offerTourHandoff self-guards (one-time + only if a persona exists).
    get().offerTourHandoff();
  },

  dismissOnboarding: () => {
    const currentStep = get().onboardingStep;
    trackMetric("onboarding.dismissed", { at_step: currentStep });
    set({
      onboardingActive: false,
      onboardingDismissedAtStep: currentStep,
    });
    persistOnboarding({ completed: get().onboardingCompleted, dismissedAtStep: currentStep, tourHandoffOffered: get().tourHandoffOffered });
  },

  reopenOnboarding: () => {
    trackMetric("onboarding.reopened");
    set({
      onboardingActive: true,
      onboardingCompleted: false,
      onboardingStep: "appearance",
      onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
      onboardingSelectedReviewId: null,
      onboardingCreatedPersonaId: null,
      onboardingDismissedAtStep: null,
    });
    persistOnboarding({ completed: false, dismissedAtStep: null, tourHandoffOffered: get().tourHandoffOffered });
  },

  offerTourHandoff: () => {
    const s = get();
    // One-time — never re-offer once shown (persisted flag).
    if (s.tourHandoffOffered) return;
    // Only a genuine modal completion (a created, live agent) hands off — a
    // half-finished modal has nothing to hand off from.
    if (!s.onboardingCreatedPersonaId) return;
    // If the user already finished the tour some other way, don't nag.
    const alreadyToured =
      s.isTourCompleted?.("getting-started") || s.isTourCompleted?.("getting-started-simple");
    if (alreadyToured) return;
    trackMetric("onboarding.tour_offer_shown");
    set({ tourHandoffVisible: true, tourHandoffOffered: true });
    persistOnboarding({
      completed: s.onboardingCompleted,
      dismissedAtStep: s.onboardingDismissedAtStep,
      tourHandoffOffered: true,
    });
  },

  acceptTourHandoff: (tourId) => {
    trackMetric("onboarding.tour_offer_accepted", { tour: tourId });
    set({ tourHandoffVisible: false });
    // Modal-aware start: carry over `persona-creation` as done (the modal
    // adopted a template = a live first agent), so the tour skips re-teaching
    // agent creation. Honest — the step's outcome is genuinely satisfied — and
    // startTour's own firstUnfinished cursor lands the user on the next real step.
    get().startTour(tourId, { preCompletedSteps: ["persona-creation"] });
  },

  dismissTourHandoff: () => {
    trackMetric("onboarding.tour_offer_dismissed");
    set({ tourHandoffVisible: false });
  },
});
