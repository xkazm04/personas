import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { trackInteraction } from '@/lib/sentry';
import * as Sentry from '@sentry/react';

/** Observable load state for the onboarding template list. */
export type TemplateLoadPhase = 'loading' | 'loaded' | 'empty' | 'error';

export interface TemplateLoadState {
  phase: TemplateLoadPhase;
  /** Which backend path produced the current template list (for diagnostics). */
  source: 'trending' | 'fallback' | null;
  error: string | null;
}

/** Observable scan state for desktop app discovery. */
export type DiscoveryScanPhase = 'scanning' | 'success' | 'error';

export interface DiscoveryScanState {
  phase: DiscoveryScanPhase;
  error: string | null;
}

function countTemplateLoad(phase: TemplateLoadPhase, source: 'trending' | 'fallback' | null) {
  try {
    Sentry.metrics.count('onboarding.templates.load', 1, {
      attributes: { phase, source: source ?? 'none' },
    });
  } catch (err) { silentCatch("features/onboarding/components/useOnboardingState:catch1")(err); }
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
  const [isAdopting, setIsAdopting] = useState(false);
  // Dedupe key: latest (templateId, click-timestamp) pair we accepted, so
  // rapid double-clicks that slip past the React state update don't open two
  // wizards or complete adoption twice.
  const adoptionDedupeRef = useRef<{ reviewId: string; at: number } | null>(null);

  // -- Desktop discovery state --
  const [discoveredApps, setDiscoveredApps] = useState<DiscoveredApp[]>([]);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryScanState>({
    phase: 'scanning',
    error: null,
  });
  const [discoveryReloadNonce, setDiscoveryReloadNonce] = useState(0);
  const [approvedApps, setApprovedApps] = useState<Set<string>>(new Set());
  const [approvingApp, setApprovingApp] = useState<string | null>(null);

  // Run desktop discovery on mount and on retry. We track an explicit
  // (scanning | success | error) phase so a network blip or missing native
  // binary surfaces a Retry button instead of silently rendering the same
  // empty state a user with zero installed apps would see.
  useEffect(() => {
    if (!onboardingActive) return;
    let cancelled = false;
    setDiscoveryState({ phase: 'scanning', error: null });
    Sentry.addBreadcrumb({
      category: 'onboarding.discover',
      message: 'Desktop discovery started',
      level: 'info',
    });

    discoverDesktopApps()
      .then((apps) => {
        if (cancelled) return;
        setDiscoveredApps(apps);
        setDiscoveryState({ phase: 'success', error: null });
        Sentry.addBreadcrumb({
          category: 'onboarding.discover',
          message: `Desktop discovery succeeded (${apps.length} apps)`,
          level: 'info',
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setDiscoveredApps([]);
        setDiscoveryState({ phase: 'error', error: message });
        Sentry.addBreadcrumb({
          category: 'onboarding.discover',
          message: `Desktop discovery failed: ${message}`,
          level: 'error',
        });
        Sentry.captureException(err, {
          tags: { event: 'onboarding.discover.failed' },
        });
      });

    return () => { cancelled = true; };
  }, [onboardingActive, discoveryReloadNonce]);

  const retryDesktopScan = useCallback(() => {
    setDiscoveryReloadNonce((n) => n + 1);
  }, []);

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
    trackInteraction('onboarding', 'step_complete', 'appearance');
    completeOnboardingStep('appearance');
    setOnboardingStep('discover');
  }, [completeOnboardingStep, setOnboardingStep]);

  const handleNextFromDiscover = useCallback(() => {
    trackInteraction('onboarding', 'step_complete', 'discover');
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
    // Guard against rapid double-click: if we're already mid-adoption or if
    // the same template was clicked again within 1s, ignore the second call.
    if (isAdopting || showAdoptionWizard) return;
    const now = Date.now();
    const last = adoptionDedupeRef.current;
    if (last && last.reviewId === onboardingSelectedReviewId && now - last.at < 1000) return;
    adoptionDedupeRef.current = { reviewId: onboardingSelectedReviewId, at: now };
    setIsAdopting(true);
    trackInteraction('onboarding', 'step_complete', 'pick-template');
    completeOnboardingStep('pick-template');
    setOnboardingStep('adopt');
    setShowAdoptionWizard(true);
  };

  const handleAdoptionComplete = async (personaId: string) => {
    setShowAdoptionWizard(false);
    setIsAdopting(false);
    trackInteraction('onboarding', 'step_complete', 'adopt');
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
    setIsAdopting(false);
    if (!onboardingStepCompleted['adopt']) {
      setOnboardingStep('pick-template');
    }
  };

  const handleExecutionComplete = useCallback(() => {
    trackInteraction('onboarding', 'step_complete', 'execute');
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
    isAdopting,
    selectedReview,
    createdPersona,
    // Desktop discovery
    discoveredApps,
    discoveryState,
    isScanning: discoveryState.phase === 'scanning',
    retryDesktopScan,
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
