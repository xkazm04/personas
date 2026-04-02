/**
 * AdoptionWizardContext -- provides wizard state, actions, derived data, and
 * async handlers to all step components via React context, eliminating the
 * 20-35 props previously drilled through AdoptionWizardModal.
 *
 * Internally composed from focused hooks:
 *  - useAdoptionInit: initialization + draft restore
 *  - useAdoptionDerived: useCaseFlows, readiness, requirements, completedSteps
 *  - useAdoptionAutoResolve: credential + connector auto-matching
 *  - useAdoptionActions: step transitions, quick adopt, draft recovery
 */
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import { useVaultStore } from "@/stores/vaultStore";
import { verifyTemplate } from '@/lib/templates/templateVerification';
import { scanPersonaDraft } from '@/lib/templates/personaSafetyScanner';
import { useAdoptReducer } from './hooks/useAdoptReducer';
import { useAsyncTransform } from './hooks/useAsyncTransform';
import { useAdoptionInit } from './hooks/useAdoptionInit';
import { useAdoptionDerived } from './hooks/useAdoptionDerived';
import { useAdoptionAutoResolve } from './hooks/useAdoptionAutoResolve';
import { useAdoptionActions } from './hooks/useAdoptionActions';
import type { AdoptionWizardContextType } from './state/adoptionWizardTypes';

// Re-export step transitions from their dedicated module
export { STEP_TRANSITIONS, type StepAction } from './state/stepTransitions';
// Re-export the context type for consumers
export type { AdoptionWizardContextType } from './state/adoptionWizardTypes';

const AdoptionWizardCtx = createContext<AdoptionWizardContextType | null>(null);

/** Access the adoption wizard context from any step component. */
export function useAdoptionWizard(): AdoptionWizardContextType {
  const ctx = useContext(AdoptionWizardCtx);
  if (!ctx) throw new Error('useAdoptionWizard must be used within AdoptionWizardProvider');
  return ctx;
}

// -- Provider --

interface AdoptionWizardProviderProps {
  isOpen: boolean;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
  children: ReactNode;
}

export function AdoptionWizardProvider({
  isOpen,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
  children,
}: AdoptionWizardProviderProps) {
  // When the wizard is closed, skip the entire heavy hook tree.
  // This avoids running 5 hooks + verification + safety scan on every gallery re-render.
  if (!isOpen) {
    return <>{children}</>;
  }

  return (
    <AdoptionWizardProviderInner
      isOpen={isOpen}
      review={review}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      onPersonaCreated={onPersonaCreated}
    >
      {children}
    </AdoptionWizardProviderInner>
  );
}

function AdoptionWizardProviderInner({
  isOpen,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
  children,
}: AdoptionWizardProviderProps) {
  const storeCredentials = useVaultStore((s) => s.credentials);
  const wizard = useAdoptReducer();
  const { state } = wizard;

  // Shared refs for cross-hook coordination
  const manualSelectionsRef = useRef<Set<string>>(new Set());
  const autoResolveRanRef = useRef(false);
  const highWaterMarkRef = useRef(0);

  // -- Layer 1: Initialization + draft restore --

  const { storedDraft, draftRestoredRef } = useAdoptionInit({
    isOpen,
    review,
    wizard,
    manualSelectionsRef,
    autoResolveRanRef,
    highWaterMarkRef,
  });

  // -- Template verification --

  const verification = useMemo<TemplateVerification>(() => {
    if (!review) {
      return {
        origin: 'unknown',
        trustLevel: 'untrusted',
        contentHash: null,
        integrityValid: false,
        sandboxPolicy: null,
      };
    }
    return verifyTemplate({
      testCaseId: review.test_case_id,
      testRunId: review.test_run_id,
      isDesignGenerated: !review.test_run_id.startsWith('seed-'),
      designResultJson: review.design_result,
    });
  }, [review]);

  // -- Safety scan --

  const safetyScan = useMemo<ScanResult | null>(() => {
    if (!state.draft) return null;
    return scanPersonaDraft(state.draft);
  }, [state.draft]);

  // -- Async transform orchestration --

  const {
    currentAdoptId,
    isRestoring,
    startTransform,
    cancelTransform,
    continueTransform,
    confirmSave,
    cleanupAll,
  } = useAsyncTransform({
    state,
    wizard,
    reviewTestCaseName: review?.test_case_name,
    onPersonaCreated,
    isOpen,
    sandboxPolicy: verification.sandboxPolicy,
    safetyScan,
  });

  // -- Layer 2: Derived data --

  const liveCredentials = storeCredentials.length > 0 ? storeCredentials : credentials;

  const {
    useCaseFlows,
    designResult,
    hasDatabaseConnector,
    readinessStatuses,
    adoptionRequirements,
    requiredConnectors,
    completedSteps,
  } = useAdoptionDerived({
    review,
    state,
    wizard,
    credentials,
    connectorDefinitions,
    highWaterMarkRef,
  });

  // -- Layer 3: Auto-resolve --

  useAdoptionAutoResolve({
    state,
    wizard,
    requiredConnectors,
    liveCredentials,
    manualSelectionsRef,
    autoResolveRanRef,
    storedDraft,
    draftRestoredRef,
    review,
  });

  // -- Layer 4: Actions --

  const asyncOps = useMemo(
    () => ({ currentAdoptId, isRestoring, startTransform, cancelTransform, continueTransform, confirmSave, cleanupAll }),
    [currentAdoptId, isRestoring, startTransform, cancelTransform, continueTransform, confirmSave, cleanupAll],
  );

  const {
    handleNext,
    setConnectorCredential,
    clearConnectorCredential,
    handleCredentialCreated,
    handleSkipQuestions,
    updateDraft,
    quickAdopt,
    enterFullWizard,
    saveDraftToStore,
    discardDraft,
  } = useAdoptionActions({
    state,
    wizard,
    async: asyncOps,
    requiredConnectors,
    adoptionRequirements,
    manualSelectionsRef,
  });

  // -- Context value --

  const value = useMemo<AdoptionWizardContextType>(
    () => ({
      state,
      wizard,
      useCaseFlows,
      readinessStatuses,
      adoptionRequirements,
      requiredConnectors,
      completedSteps,
      liveCredentials,
      designResult,
      connectorDefinitions,
      verification,
      safetyScan,
      hasDatabaseConnector,
      setConnectorCredential,
      clearConnectorCredential,
      currentAdoptId,
      isRestoring,
      startTransform,
      cancelTransform,
      continueTransform,
      confirmSave,
      cleanupAll,
      handleNext,
      handleCredentialCreated,
      handleSkipQuestions,
      updateDraft,
      quickAdopt,
      enterFullWizard,
      saveDraftToStore,
      discardDraft,
    }),
    [
      state,
      wizard,
      useCaseFlows,
      readinessStatuses,
      adoptionRequirements,
      requiredConnectors,
      completedSteps,
      liveCredentials,
      designResult,
      connectorDefinitions,
      verification,
      safetyScan,
      hasDatabaseConnector,
      setConnectorCredential,
      clearConnectorCredential,
      currentAdoptId,
      isRestoring,
      startTransform,
      cancelTransform,
      continueTransform,
      confirmSave,
      cleanupAll,
      handleNext,
      handleCredentialCreated,
      handleSkipQuestions,
      updateDraft,
      quickAdopt,
      enterFullWizard,
      saveDraftToStore,
      discardDraft,
    ],
  );

  return <AdoptionWizardCtx.Provider value={value}>{children}</AdoptionWizardCtx.Provider>;
}
