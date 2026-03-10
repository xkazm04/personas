import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { listDesignReviews, getTrendingTemplates } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

export function useOnboardingState() {
  const onboardingActive = usePersonaStore((s) => s.onboardingActive);
  const onboardingStep = usePersonaStore((s) => s.onboardingStep);
  const onboardingStepCompleted = usePersonaStore((s) => s.onboardingStepCompleted);
  const onboardingSelectedReviewId = usePersonaStore((s) => s.onboardingSelectedReviewId);
  const onboardingCreatedPersonaId = usePersonaStore((s) => s.onboardingCreatedPersonaId);
  const setOnboardingStep = usePersonaStore((s) => s.setOnboardingStep);
  const completeOnboardingStep = usePersonaStore((s) => s.completeOnboardingStep);
  const setOnboardingSelectedReview = usePersonaStore((s) => s.setOnboardingSelectedReview);
  const setOnboardingCreatedPersona = usePersonaStore((s) => s.setOnboardingCreatedPersona);
  const finishOnboarding = usePersonaStore((s) => s.finishOnboarding);
  const dismissOnboarding = usePersonaStore((s) => s.dismissOnboarding);

  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const personas = usePersonaStore((s) => s.personas);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);

  const [templates, setTemplates] = useState<PersonaDesignReview[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [showAdoptionWizard, setShowAdoptionWizard] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PersonaDesignReview | null>(null);

  // Load top 3 starter templates
  useEffect(() => {
    if (!onboardingActive) return;
    let cancelled = false;
    setIsLoadingTemplates(true);

    (async () => {
      try {
        let reviews: PersonaDesignReview[] = [];
        try {
          reviews = await getTrendingTemplates(3);
        } catch {
          // intentional: non-critical
        }
        if (reviews.length === 0) {
          reviews = await listDesignReviews(undefined, 3);
        }
        if (!cancelled) setTemplates(reviews);
      } catch {
        // intentional: non-critical
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setIsLoadingTemplates(false);
      }
    })();

    return () => { cancelled = true; };
  }, [onboardingActive]);

  // When a template is selected, find the review object
  useEffect(() => {
    if (onboardingSelectedReviewId) {
      const review = templates.find((t) => t.id === onboardingSelectedReviewId);
      setSelectedReview(review ?? null);
    } else {
      setSelectedReview(null);
    }
  }, [onboardingSelectedReviewId, templates]);

  const createdPersona = useMemo(
    () => personas.find((p) => p.id === onboardingCreatedPersonaId),
    [personas, onboardingCreatedPersonaId],
  );

  const handleTemplateSelect = (reviewId: string) => {
    setOnboardingSelectedReview(reviewId);
  };

  const handleNextFromPick = () => {
    if (!onboardingSelectedReviewId || !selectedReview) return;
    completeOnboardingStep('pick-template');
    setOnboardingStep('adopt');
    setShowAdoptionWizard(true);
  };

  const handleAdoptionComplete = () => {
    setShowAdoptionWizard(false);
    completeOnboardingStep('adopt');
    fetchPersonas().then(() => {
      const store = usePersonaStore.getState();
      const sorted = [...store.personas].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const newest = sorted[0];
      if (newest) {
        setOnboardingCreatedPersona(newest.id);
      }
      setOnboardingStep('execute');
    });
  };

  const handleAdoptionClose = () => {
    setShowAdoptionWizard(false);
    if (!onboardingStepCompleted['adopt']) {
      setOnboardingStep('pick-template');
    }
  };

  const handleExecutionComplete = useCallback(() => {
    completeOnboardingStep('execute');
  }, [completeOnboardingStep]);

  const handleFinish = () => {
    finishOnboarding();
  };

  return {
    onboardingActive,
    onboardingStep,
    onboardingStepCompleted,
    onboardingSelectedReviewId,
    onboardingCreatedPersonaId,
    dismissOnboarding,
    credentials,
    connectorDefinitions,
    templates,
    isLoadingTemplates,
    showAdoptionWizard,
    selectedReview,
    createdPersona,
    handleTemplateSelect,
    handleNextFromPick,
    handleAdoptionComplete,
    handleAdoptionClose,
    handleExecutionComplete,
    handleFinish,
  };
}
