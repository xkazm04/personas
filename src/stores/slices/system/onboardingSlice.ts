import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/types/types";
import * as Sentry from "@sentry/react";

// -- Types --------------------------------------------------------------

export type OnboardingStep = "discover" | "pick-template" | "adopt" | "execute";

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

// -- Sentry metrics helpers ---------------------------------------------

function trackStepCompletion(step: OnboardingStep) {
  try {
    Sentry.metrics.count("onboarding.step_completed", 1, { attributes: { step } });
  } catch {
    // intentional: non-critical -- Sentry may not be initialized in dev
  }
}

function trackOnboardingComplete() {
  try {
    Sentry.metrics.count("onboarding.flow_completed", 1);
  } catch {
    // intentional: non-critical -- Sentry may not be initialized in dev
  }
}

function trackOnboardingDismissed(atStep: OnboardingStep) {
  try {
    Sentry.metrics.count("onboarding.dismissed", 1, { attributes: { at_step: atStep } });
  } catch {
    // intentional: non-critical -- Sentry may not be initialized in dev
  }
}

// -- Slice --------------------------------------------------------------

const INITIAL_STEP_STATUS: Record<OnboardingStep, boolean> = {
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
    try {
      Sentry.metrics.count("onboarding.started", 1);
    } catch {
      // intentional: non-critical -- Sentry may not be initialized in dev
    }
    set({
      onboardingActive: true,
      onboardingStep: "discover",
      onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
      onboardingSelectedReviewId: null,
      onboardingCreatedPersonaId: null,
      onboardingDismissedAtStep: null,
    });
  },

  resumeOnboarding: () => {
    const { onboardingDismissedAtStep, onboardingCompleted } = get();
    if (onboardingCompleted || !onboardingDismissedAtStep) return;
    try {
      Sentry.metrics.count("onboarding.resumed", 1, { attributes: { at_step: onboardingDismissedAtStep } });
    } catch {
      // intentional: non-critical -- Sentry may not be initialized in dev
    }
    set({
      onboardingActive: true,
      onboardingStep: onboardingDismissedAtStep,
      onboardingDismissedAtStep: null,
    });
  },

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboardingStep: (step) => {
    trackStepCompletion(step);
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
    trackOnboardingComplete();
    set({
      onboardingActive: false,
      onboardingCompleted: true,
      onboardingStep: "discover",
      onboardingDismissedAtStep: null,
    });
  },

  dismissOnboarding: () => {
    const currentStep = get().onboardingStep;
    trackOnboardingDismissed(currentStep);
    set({
      onboardingActive: false,
      onboardingDismissedAtStep: currentStep,
    });
  },
});
