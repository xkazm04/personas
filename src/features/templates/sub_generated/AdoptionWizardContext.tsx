/**
 * AdoptionWizardContext — provides wizard state, actions, derived data, and
 * async handlers to all step components via React context, eliminating the
 * 20-35 props previously drilled through AdoptionWizardModal.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { usePersonaStore } from '@/stores/personaStore';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { getAdoptionRequirements } from './templateVariables';
import { getArchitectureComponent } from '@/lib/credentials/connectorRoles';
import { deriveRequirementsFromFlows } from './steps/ChooseStep';
import type { RequiredConnector } from './steps/ConnectStep';
import {
  useAdoptReducer,
  ADOPT_STEPS,
  ADOPT_STEP_META,
  type AdoptWizardStep,
  type AdoptState,
} from './useAdoptReducer';
import { useAsyncTransform } from './useAsyncTransform';

// ── Step transition map ─────────────────────────────────────────────────
// Replaces the hard-coded switch in handleNext. Each step declares its
// transition: either a direct step navigation or an async action.

export type StepAction = 'navigate' | 'transform' | 'continue' | 'confirm' | 'close';

interface StepTransition {
  action: StepAction;
  target?: AdoptWizardStep;
}

export const STEP_TRANSITIONS: Record<
  AdoptWizardStep,
  (state: AdoptState) => StepTransition
> = {
  choose: () => ({ action: 'navigate', target: 'connect' }),
  connect: () => ({ action: 'navigate', target: 'tune' }),
  tune: (s) =>
    s.backgroundAdoptId
      ? { action: 'continue' }
      : { action: 'transform' },
  build: (s) =>
    s.draft
      ? { action: 'navigate', target: 'create' }
      : { action: 'navigate' }, // no-op when no draft
  create: () => ({ action: 'confirm' }),
};

// ── Context type ────────────────────────────────────────────────────────

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
  designResult: DesignAnalysisResult | null;
  connectorDefinitions: ConnectorDefinition[];

  // Async transform orchestration
  currentAdoptId: string | null;
  isRestoring: boolean;
  startTransform: () => Promise<void>;
  cancelTransform: () => Promise<void>;
  continueTransform: () => Promise<void>;
  confirmSave: () => Promise<void>;
  cleanupAll: () => Promise<void>;

  // Convenience helpers
  handleNext: () => void;
  handleCredentialCreated: () => void;
  handleSkipQuestions: () => void;
  updateDraft: (updater: (d: N8nPersonaDraft) => N8nPersonaDraft) => void;
}

const AdoptionWizardCtx = createContext<AdoptionWizardContextType | null>(null);

/** Access the adoption wizard context from any step component. */
export function useAdoptionWizard(): AdoptionWizardContextType {
  const ctx = useContext(AdoptionWizardCtx);
  if (!ctx) throw new Error('useAdoptionWizard must be used within AdoptionWizardProvider');
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────────

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
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const storeCredentials = usePersonaStore((s) => s.credentials);
  const wizard = useAdoptReducer();
  const { state } = wizard;

  // ── Async transform orchestration ──

  const async = useAsyncTransform({
    state,
    wizard,
    reviewTestCaseName: review?.test_case_name,
    onPersonaCreated,
    isOpen,
  });

  // ── Initialize on open ──

  useEffect(() => {
    if (!isOpen || !review) return;
    if (state.backgroundAdoptId) return;

    const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
    if (!designResult) return;

    wizard.init(review.test_case_name, review.id, designResult, review.design_result ?? '');
  }, [isOpen, review, wizard.init, state.backgroundAdoptId]);

  // ── Use case flows ──

  const useCaseFlows = useMemo<UseCaseFlow[]>(() => {
    if (!review) return [];
    const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    if (flows.length > 0) return flows;
    const raw = state.designResult as unknown as Record<string, unknown> | null;
    return raw?.use_case_flows
      ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
      : [];
  }, [review, state.designResult]);

  // Pre-select all use case IDs on init
  useEffect(() => {
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size === 0 && state.step === 'choose') {
      for (const flow of useCaseFlows) wizard.toggleUseCaseId(flow.id);
    }
  }, [useCaseFlows, state.selectedUseCaseIds.size, state.step, wizard.toggleUseCaseId]);

  // ── Derived data ──

  const designResult = state.designResult;

  const readinessStatuses = useMemo<ConnectorReadinessStatus[]>(() => {
    if (!designResult?.suggested_connectors) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    return deriveConnectorReadiness(designResult.suggested_connectors, installedNames, credTypes);
  }, [designResult, connectorDefinitions, credentials]);

  const adoptionRequirements = useMemo(
    () => (designResult ? getAdoptionRequirements(designResult) : []),
    [designResult],
  );

  const requiredConnectors = useMemo<RequiredConnector[]>(() => {
    if (!designResult) return [];
    const allConnectors = designResult.suggested_connectors ?? [];

    let neededOriginalNames: Set<string>;
    if (useCaseFlows.length > 0 && state.selectedUseCaseIds.size > 0) {
      const { connectorNames } = deriveRequirementsFromFlows(useCaseFlows, state.selectedUseCaseIds);
      neededOriginalNames = connectorNames;
    } else {
      neededOriginalNames = new Set(
        allConnectors
          .filter(
            (c) =>
              state.selectedConnectorNames.has(c.name) ||
              state.selectedConnectorNames.has(state.connectorSwaps[c.name] || ''),
          )
          .map((c) => c.name),
      );
    }

    return allConnectors
      .filter((c) => neededOriginalNames.has(c.name))
      .map((c) => {
        const component = getArchitectureComponent(c.name);
        const activeName = state.connectorSwaps[c.name] || c.name;
        return {
          name: c.name,
          activeName,
          role: c.role || component?.role,
          roleLabel: component?.label,
          roleMembers: component?.members,
          setup_url: c.setup_url,
          setup_instructions: c.setup_instructions,
          credential_fields: c.credential_fields,
        };
      });
  }, [designResult, useCaseFlows, state.selectedUseCaseIds, state.selectedConnectorNames, state.connectorSwaps]);

  const liveCredentials = storeCredentials.length > 0 ? storeCredentials : credentials;

  const completedSteps = useMemo<Set<AdoptWizardStep>>(() => {
    const completed = new Set<AdoptWizardStep>();
    const currentIndex = ADOPT_STEP_META[state.step].index;
    for (const step of ADOPT_STEPS) {
      if (ADOPT_STEP_META[step].index < currentIndex) completed.add(step);
    }
    if (state.created) completed.add('create');
    return completed;
  }, [state.step, state.created]);

  // ── Step transition handler ──

  const handleNext = useCallback(() => {
    const transition = STEP_TRANSITIONS[state.step](state);
    switch (transition.action) {
      case 'navigate':
        if (transition.target) wizard.goToStep(transition.target);
        break;
      case 'transform':
        void async.startTransform();
        break;
      case 'continue':
        void async.continueTransform();
        break;
      case 'confirm':
        void async.confirmSave();
        break;
      case 'close':
        break;
    }
  }, [state, wizard, async]);

  // ── Convenience helpers ──

  const handleCredentialCreated = useCallback(() => {
    void fetchCredentials();
  }, [fetchCredentials]);

  const handleSkipQuestions = useCallback(() => {
    void async.continueTransform();
  }, [async.continueTransform]);

  const updateDraft = useCallback(
    (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => {
      if (!state.draft) return;
      wizard.draftUpdated(updater(state.draft));
    },
    [state.draft, wizard],
  );

  // ── Context value ──

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
      currentAdoptId: async.currentAdoptId,
      isRestoring: async.isRestoring,
      startTransform: async.startTransform,
      cancelTransform: async.cancelTransform,
      continueTransform: async.continueTransform,
      confirmSave: async.confirmSave,
      cleanupAll: async.cleanupAll,
      handleNext,
      handleCredentialCreated,
      handleSkipQuestions,
      updateDraft,
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
      async,
      handleNext,
      handleCredentialCreated,
      handleSkipQuestions,
      updateDraft,
    ],
  );

  return <AdoptionWizardCtx.Provider value={value}>{children}</AdoptionWizardCtx.Provider>;
}
