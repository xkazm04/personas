import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { listDesignReviews, getTrendingTemplates } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import {
  discoverDesktopApps,
  getDesktopConnectorManifest,
  approveDesktopCapabilities,
  type DiscoveredApp,
} from '@/api/system/desktop';

export function useOnboardingState() {
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const onboardingStep = useSystemStore((s) => s.onboardingStep);
  const onboardingStepCompleted = useSystemStore((s) => s.onboardingStepCompleted);
  const onboardingSelectedReviewId = useSystemStore((s) => s.onboardingSelectedReviewId);
  const onboardingCreatedPersonaId = useSystemStore((s) => s.onboardingCreatedPersonaId);
  const setOnboardingStep = useSystemStore((s) => s.setOnboardingStep);
  const completeOnboardingStep = useSystemStore((s) => s.completeOnboardingStep);
  const setOnboardingSelectedReview = useSystemStore((s) => s.setOnboardingSelectedReview);
  const setOnboardingCreatedPersona = useSystemStore((s) => s.setOnboardingCreatedPersona);
  const finishOnboarding = useSystemStore((s) => s.finishOnboarding);
  const dismissOnboarding = useSystemStore((s) => s.dismissOnboarding);

  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const personas = useAgentStore((s) => s.personas);
  const fetchPersonas = useAgentStore((s) => s.fetchPersonas);

  const [templates, setTemplates] = useState<PersonaDesignReview[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [showAdoptionWizard, setShowAdoptionWizard] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PersonaDesignReview | null>(null);

  // -- Desktop discovery state --
  const [discoveredApps, setDiscoveredApps] = useState<DiscoveredApp[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [approvedApps, setApprovedApps] = useState<Set<string>>(new Set());
  const [approvingApp, setApprovingApp] = useState<string | null>(null);

  // Run desktop discovery on mount
  useEffect(() => {
    if (!onboardingActive) return;
    let cancelled = false;
    setIsScanning(true);

    discoverDesktopApps()
      .then((apps) => {
        if (!cancelled) setDiscoveredApps(apps);
      })
      .catch(() => {
        if (!cancelled) setDiscoveredApps([]);
      })
      .finally(() => {
        if (!cancelled) setIsScanning(false);
      });

    return () => { cancelled = true; };
  }, [onboardingActive]);

  const handleApproveApp = useCallback(async (connectorName: string) => {
    setApprovingApp(connectorName);
    try {
      const manifest = await getDesktopConnectorManifest(connectorName);
      if (manifest) {
        await approveDesktopCapabilities(connectorName, manifest.capabilities);
      }
      setApprovedApps((prev) => new Set([...prev, connectorName]));
    } catch {
      // intentional: non-critical — user can approve later from Connectors tab
    } finally {
      setApprovingApp(null);
    }
  }, []);

  const handleNextFromAppearance = useCallback(() => {
    completeOnboardingStep('appearance');
    setOnboardingStep('discover');
  }, [completeOnboardingStep, setOnboardingStep]);

  const handleNextFromDiscover = useCallback(() => {
    completeOnboardingStep('discover');
    setOnboardingStep('pick-template');
  }, [completeOnboardingStep, setOnboardingStep]);

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
      const sorted = [...useAgentStore.getState().personas].sort(
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
    // Desktop discovery
    discoveredApps,
    isScanning,
    approvedApps,
    approvingApp,
    handleApproveApp,
    handleNextFromAppearance,
    handleNextFromDiscover,
    // Template / adoption / execution
    handleTemplateSelect,
    handleNextFromPick,
    handleAdoptionComplete,
    handleAdoptionClose,
    handleExecutionComplete,
    handleFinish,
  };
}
