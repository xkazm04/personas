import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/types/types";
import * as Sentry from "@sentry/react";

// -- Types --------------------------------------------------------------

export type OnboardingStep = "appearance" | "discover" | "pick-template" | "adopt" | "execute";

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

  // Actions
  startOnboarding: () => void;
  resumeOnboarding: () => void;
  setOnboardingStep: (step: OnboardingStep) => void;
  completeOnboardingStep: (step: OnboardingStep) => void;
  setOnboardingSelectedReview: (reviewId: string | null) => void;
  setOnboardingCreatedPersona: (personaId: string | null) => void;
  finishOnboarding: () => void;
  dismissOnboarding: () => void;
}

// -- Sentry metrics helper ----------------------------------------------

function trackMetric(name: string, attributes?: Record<string, string>) {
  try {
    Sentry.metrics.count(name, 1, attributes ? { attributes } : undefined);
  } catch {
    // intentional: non-critical -- Sentry may not be initialized in dev
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
  onboardingCompleted: false,
  onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
  onboardingSelectedReviewId: null,
  onboardingCreatedPersonaId: null,
  onboardingDismissedAtStep: null,

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
  },

  dismissOnboarding: () => {
    const currentStep = get().onboardingStep;
    trackMetric("onboarding.dismissed", { at_step: currentStep });
    set({
      onboardingActive: false,
      onboardingDismissedAtStep: currentStep,
    });
  },
});
