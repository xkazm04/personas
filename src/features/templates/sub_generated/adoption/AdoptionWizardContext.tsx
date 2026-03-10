/**
 * AdoptionWizardContext â€” provides wizard state, actions, derived data, and
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
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { AgentIR, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import { usePersonaStore } from '@/stores/personaStore';
import { verifyTemplate } from '@/lib/templates/templateVerification';
import { scanPersonaDraft } from '@/lib/templates/personaSafetyScanner';
import type { RequiredConnector } from './steps/ConnectStep';
import {
  useAdoptReducer,
  type AdoptWizardStep,
  type AdoptState,
} from './useAdoptReducer';
import { useAsyncTransform } from './useAsyncTransform';
import { useAdoptionInit } from './useAdoptionInit';
import { useAdoptionDerived } from './useAdoptionDerived';
import { useAdoptionAutoResolve } from './useAdoptionAutoResolve';
import { useAdoptionActions } from './useAdoptionActions';
import { getAdoptionRequirements } from './templateVariables';

// Re-export step transitions from their dedicated module
export { STEP_TRANSITIONS, type StepAction } from './stepTransitions';

// â”€â”€ Context type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AdoptionWizardContextType {
  // Core state & actions
  state: AdoptState;
  wizard: ReturnType<typeof useAdoptReducer>;

  // Derived data
  useCaseFlows: UseCaseFlow[];
  readinessStatuses: ConnectorReadinessStatus[];
  adoptionRequirements: ReturnType<typeof getAdoptionRequirements>;
  requiredConnectors: RequiredConnector[];
  completedSteps: Set<AdoptWizardStep>;
  liveCredentials: CredentialMetadata[];
  designResult: AgentIR | null;
  connectorDefinitions: ConnectorDefinition[];

  /** Template origin verification and sandbox policy */
  verification: TemplateVerification;

  /** Safety scan results for the current draft (null if no draft) */
  safetyScan: ScanResult | null;

  /** Whether template uses a database connector */
  hasDatabaseConnector: boolean;

  // Async transform orchestration
  currentAdoptId: string | null;
  isRestoring: boolean;
  startTransform: () => Promise<void>;
  cancelTransform: () => Promise<void>;
  continueTransform: () => Promise<void>;
  confirmSave: () => Promise<void>;
  cleanupAll: () => Promise<void>;

  // Credential actions (manual-selection-aware wrappers)
  setConnectorCredential: (connectorName: string, credentialId: string) => void;
  clearConnectorCredential: (connectorName: string) => void;

  // Convenience helpers
  handleNext: () => void;
  handleCredentialCreated: () => void;
  handleSkipQuestions: () => void;
  updateDraft: (updater: (d: N8nPersonaDraft) => N8nPersonaDraft) => void;

  // Auto-adoption
  quickAdopt: () => void;
  enterFullWizard: () => void;

  // Draft recovery
  saveDraftToStore: () => void;
  discardDraft: () => void;
}

const AdoptionWizardCtx = createContext<AdoptionWizardContextType | null>(null);

/** Access the adoption wizard context from any step component. */
export function useAdoptionWizard(): AdoptionWizardContextType {
  const ctx = useContext(AdoptionWizardCtx);
  if (!ctx) throw new Error('useAdoptionWizard must be used within AdoptionWizardProvider');
  return ctx;
}

// â”€â”€ Provider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const storeCredentials = usePersonaStore((s) => s.credentials);
  const wizard = useAdoptReducer();
  const { state } = wizard;

  // Shared refs for cross-hook coordination
  const manualSelectionsRef = useRef<Set<string>>(new Set());
  const autoResolveRanRef = useRef(false);
  const highWaterMarkRef = useRef(0);

  // â”€â”€ Layer 1: Initialization + draft restore â”€â”€

  const { storedDraft, draftRestoredRef } = useAdoptionInit({
    isOpen,
    review,
    wizard,
    manualSelectionsRef,
    autoResolveRanRef,
    highWaterMarkRef,
  });

  // â”€â”€ Template verification â”€â”€

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

  // â”€â”€ Safety scan â”€â”€

  const safetyScan = useMemo<ScanResult | null>(() => {
    if (!state.draft) return null;
    return scanPersonaDraft(state.draft);
  }, [state.draft]);

  // â”€â”€ Async transform orchestration â”€â”€

  const asyncOps = useAsyncTransform({
    state,
    wizard,
    reviewTestCaseName: review?.test_case_name,
    onPersonaCreated,
    isOpen,
    sandboxPolicy: verification.sandboxPolicy,
    safetyScan,
  });

  // â”€â”€ Layer 2: Derived data â”€â”€

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

  // â”€â”€ Layer 3: Auto-resolve â”€â”€

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

  // â”€â”€ Layer 4: Actions â”€â”€

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

  // â”€â”€ Context value â”€â”€

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
      currentAdoptId: asyncOps.currentAdoptId,
      isRestoring: asyncOps.isRestoring,
      startTransform: asyncOps.startTransform,
      cancelTransform: asyncOps.cancelTransform,
      continueTransform: asyncOps.continueTransform,
      confirmSave: asyncOps.confirmSave,
      cleanupAll: asyncOps.cleanupAll,
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
      asyncOps,
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
