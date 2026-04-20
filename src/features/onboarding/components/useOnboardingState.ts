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
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import * as Sentry from '@sentry/react';

/** Observable load state for the onboarding template list. */
export type TemplateLoadPhase = 'loading' | 'loaded' | 'empty' | 'error';

export interface TemplateLoadState {
  phase: TemplateLoadPhase;
  /** Which backend path produced the current template list (for diagnostics). */
  source: 'trending' | 'fallback' | null;
  error: string | null;
}

function countTemplateLoad(phase: TemplateLoadPhase, source: 'trending' | 'fallback' | null) {
  try {
    Sentry.metrics.count('onboarding.templates.load', 1, {
      attributes: { phase, source: source ?? 'none' },
    });
  } catch {
    // intentional: Sentry may not be initialized
  }
}

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
  const [templateLoadState, setTemplateLoadState] = useState<TemplateLoadState>({
    phase: 'loading',
    source: null,
    error: null,
  });
  const [templateReloadNonce, setTemplateReloadNonce] = useState(0);
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
    } catch (err) {
      // Surface the failure: the user explicitly clicked Approve, so silent
      // re-enabling the button with no feedback violates least-surprise.
      toastCatch(
        `useOnboardingState:approveApp:${connectorName}`,
        `Could not approve ${connectorName}. You can approve it later from Connectors.`,
      )(err);
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

  // Load top 3 starter templates. Tracks an explicit (loading | loaded | empty
  // | error) phase plus which path (trending vs fallback) actually served the
  // list, so first-run users on a flaky network see a recoverable error state
  // instead of a disabled button with no explanation.
  useEffect(() => {
    if (!onboardingActive) return;
    let cancelled = false;
    setTemplateLoadState({ phase: 'loading', source: null, error: null });

    (async () => {
      let reviews: PersonaDesignReview[] = [];
      let source: 'trending' | 'fallback' | null = null;
      let trendingErr: unknown = null;
      let fallbackErr: unknown = null;

      try {
        reviews = await getTrendingTemplates(3);
        source = 'trending';
      } catch (err) {
        trendingErr = err;
        silentCatch('useOnboardingState:getTrendingTemplates')(err);
      }

      if (reviews.length === 0) {
        try {
          reviews = await listDesignReviews(undefined, 3);
          source = 'fallback';
        } catch (err) {
          fallbackErr = err;
          silentCatch('useOnboardingState:listDesignReviews')(err);
        }
      }

      if (cancelled) return;

      if (reviews.length > 0) {
        setTemplates(reviews);
        setTemplateLoadState({ phase: 'loaded', source, error: null });
        countTemplateLoad('loaded', source);
        return;
      }

      setTemplates([]);
      if (trendingErr && fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        setTemplateLoadState({ phase: 'error', source: null, error: msg });
        countTemplateLoad('error', null);
      } else {
        setTemplateLoadState({ phase: 'empty', source, error: null });
        countTemplateLoad('empty', source);
      }
    })();

    return () => { cancelled = true; };
  }, [onboardingActive, templateReloadNonce]);

  const retryLoadTemplates = useCallback(() => {
    setTemplateReloadNonce((n) => n + 1);
  }, []);

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

  const handleAdoptionComplete = async (personaId: string) => {
    setShowAdoptionWizard(false);
    completeOnboardingStep('adopt');
    // Explicit ID from the adoption wizard — no more guessing the newest
    // persona by created_at (which was racy against concurrent creates and
    // server-clock drift).
    setOnboardingCreatedPersona(personaId);
    // Await the persona list refresh before advancing so the Execute step
    // has an authoritative persona record to render. Failures here are
    // non-fatal — we still have the ID and can render a minimal fallback.
    try {
      await fetchPersonas();
    } catch (err) {
      silentCatch('useOnboardingState:fetchPersonasAfterAdopt')(err);
    }
    setOnboardingStep('execute');
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
    templateLoadState,
    isLoadingTemplates: templateLoadState.phase === 'loading',
    retryLoadTemplates,
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
