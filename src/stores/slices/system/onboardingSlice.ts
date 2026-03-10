import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import * as Sentry from "@sentry/react";

// ── Types ──────────────────────────────────────────────────────────────

export type OnboardingStep = "pick-template" | "adopt" | "execute";

export interface OnboardingSlice {
  // State
  onboardingActive: boolean;
  onboardingStep: OnboardingStep;
  onboardingCompleted: boolean;
  onboardingStepCompleted: Record<OnboardingStep, boolean>;
  onboardingSelectedReviewId: string | null;
  onboardingCreatedPersonaId: string | null;

  // Actions
  startOnboarding: () => void;
  setOnboardingStep: (step: OnboardingStep) => void;
  completeOnboardingStep: (step: OnboardingStep) => void;
  setOnboardingSelectedReview: (reviewId: string | null) => void;
  setOnboardingCreatedPersona: (personaId: string | null) => void;
  finishOnboarding: () => void;
  dismissOnboarding: () => void;
}

// ── Sentry metrics helpers ─────────────────────────────────────────────

function trackStepCompletion(step: OnboardingStep) {
  try {
    Sentry.metrics.count("onboarding.step_completed", 1, { attributes: { step } });
  } catch {
    // intentional: non-critical — Sentry may not be initialized in dev
  }
}

function trackOnboardingComplete() {
  try {
    Sentry.metrics.count("onboarding.flow_completed", 1);
  } catch {
    // intentional: non-critical — Sentry may not be initialized in dev
  }
}

function trackOnboardingDismissed(atStep: OnboardingStep) {
  try {
    Sentry.metrics.count("onboarding.dismissed", 1, { attributes: { at_step: atStep } });
  } catch {
    // intentional: non-critical — Sentry may not be initialized in dev
  }
}

// ── Slice ──────────────────────────────────────────────────────────────

const INITIAL_STEP_STATUS: Record<OnboardingStep, boolean> = {
  "pick-template": false,
  "adopt": false,
  "execute": false,
};

export const createOnboardingSlice: StateCreator<
  PersonaStore,
  [],
  [],
  OnboardingSlice
> = (set, get) => ({
  onboardingActive: false,
  onboardingStep: "pick-template",
  onboardingCompleted: false,
  onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
  onboardingSelectedReviewId: null,
  onboardingCreatedPersonaId: null,

  startOnboarding: () => {
    // Don't start if already completed or if user has personas already
    if (get().onboardingCompleted || get().personas.length > 0) return;
    try {
      Sentry.metrics.count("onboarding.started", 1);
    } catch {
      // intentional: non-critical — Sentry may not be initialized in dev
    }
    set({
      onboardingActive: true,
      onboardingStep: "pick-template",
      onboardingStepCompleted: { ...INITIAL_STEP_STATUS },
      onboardingSelectedReviewId: null,
      onboardingCreatedPersonaId: null,
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
      onboardingStep: "pick-template",
    });
  },

  dismissOnboarding: () => {
    trackOnboardingDismissed(get().onboardingStep);
    set({
      onboardingActive: false,
      onboardingCompleted: true,
    });
  },
});
