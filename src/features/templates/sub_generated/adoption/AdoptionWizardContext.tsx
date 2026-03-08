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
  useRef,
  type ReactNode,
} from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import { usePersonaStore } from '@/stores/personaStore';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { deriveConnectorReadiness } from '../shared/ConnectorReadiness';
import { getAdoptionRequirements, validateVariables } from './templateVariables';
import { getArchitectureComponent } from '@/lib/credentials/connectorRoles';
import { getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { deriveRequirementsFromFlows } from './steps/ChooseStep';
import { verifyTemplate } from '@/lib/templates/templateVerification';
import { scanPersonaDraft } from '@/lib/templates/personaSafetyScanner';
import type { RequiredConnector } from './steps/ConnectStep';
import {
  useAdoptReducer,
  ADOPT_STEPS,
  ADOPT_STEP_META,
  hasDataStep,
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
  connect: (s) => ({
    action: 'navigate',
    target: hasDataStep(s) ? 'data' : 'tune',
  }),
  data: () => ({ action: 'navigate', target: 'tune' }),
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

  /** Template origin verification and sandbox policy */
  verification: TemplateVerification;

  /** Safety scan results for the current draft (null if no draft) */
  safetyScan: ScanResult | null;

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
  const setAdoptionDraft = usePersonaStore((s) => s.setAdoptionDraft);
  const wizard = useAdoptReducer();
  const { state } = wizard;

  // ── Template verification (computed early — sandboxPolicy feeds into async transform) ──

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

  // ── Async transform orchestration ──

  const async = useAsyncTransform({
    state,
    wizard,
    reviewTestCaseName: review?.test_case_name,
    onPersonaCreated,
    isOpen,
    sandboxPolicy: verification.sandboxPolicy,
  });

  // ── Initialize on open ──

  const storedDraft = usePersonaStore((s) => s.adoptionDraft);
  const draftRestoredRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !review) return;
    if (state.backgroundAdoptId) return;

    const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
    if (!designResult) return;

    manualSelectionsRef.current = new Set();
    autoResolveRanRef.current = false;
    draftRestoredRef.current = false;
    wizard.init(review.test_case_name, review.id, designResult, review.design_result ?? '');
  }, [isOpen, review, wizard.init, state.backgroundAdoptId]);

  // ── Restore saved draft (runs once after init) ──
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!isOpen || !storedDraft || !review) return;
    if (storedDraft.reviewId !== review.id) return;
    if (state.step !== 'choose' || !state.designResult) return;

    draftRestoredRef.current = true;

    // Restore connector swaps
    for (const [original, replacement] of Object.entries(storedDraft.connectorSwaps)) {
      wizard.swapConnector(original, replacement);
    }
    // Restore credential mappings
    for (const [name, id] of Object.entries(storedDraft.connectorCredentialMap)) {
      wizard.setConnectorCredential(name, id);
    }
    // Restore variable values
    for (const [key, val] of Object.entries(storedDraft.variableValues)) {
      wizard.updateVariable(key, val);
    }
    // Navigate to saved step
    wizard.goToStep(storedDraft.step);
    // Clear the draft from store since it's now loaded
    setAdoptionDraft(null);
  }, [isOpen, storedDraft, review, state.step, state.designResult, wizard, setAdoptionDraft]);

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
      wizard.selectAllUseCases(useCaseFlows.map((f) => f.id));
    }
  }, [useCaseFlows, state.selectedUseCaseIds.size, state.step, wizard.selectAllUseCases]);

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

  // Track connectors where the user has manually selected or cleared a credential.
  // Auto-resolve will never overwrite these selections.
  const manualSelectionsRef = useRef<Set<string>>(new Set());

  // ── Auto-swap connectors without credentials ──
  // When the template's recommended connector has no user credentials but an
  // alternative in the same role does, pre-select the first adopted one.
  const autoSwapRanRef = useRef(false);
  useEffect(() => {
    if (state.step !== 'choose' || autoSwapRanRef.current || !requiredConnectors.length) return;
    const BUILTIN = new Set(['personas_messages', 'personas_database']);
    const credServiceTypes = new Set(liveCredentials.map((c) => c.service_type));

    const swaps: Array<{ original: string; replacement: string }> = [];
    for (const rc of requiredConnectors) {
      // Skip if user already has credentials for the recommended connector or it's built-in
      if (BUILTIN.has(rc.activeName) || credServiceTypes.has(rc.activeName)) continue;
      if (!rc.roleMembers || rc.roleMembers.length <= 1) continue;

      // Find the first alternative the user has credentials for (sorted by label)
      const alternatives = rc.roleMembers
        .filter((m) => m !== rc.activeName && (credServiceTypes.has(m) || BUILTIN.has(m)))
        .sort((a, b) => getConnectorMeta(a).label.toLowerCase().localeCompare(getConnectorMeta(b).label.toLowerCase()));

      if (alternatives.length > 0) {
        swaps.push({ original: rc.name, replacement: alternatives[0]! });
      }
    }

    if (swaps.length > 0) {
      autoSwapRanRef.current = true;
      for (const { original, replacement } of swaps) {
        wizard.swapConnector(original, replacement);
      }
    }
  }, [requiredConnectors, liveCredentials, state.step, wizard]);

  // ── Auto-resolve credentials ──
  // When all required connectors have exactly one matching credential,
  // auto-map them and flag autoResolved for the QuickAdoptConfirm path.
  // Only runs once on mount (autoResolved guard) and never overwrites manual picks.
  const autoResolveRanRef = useRef(false);
  useEffect(() => {
    if (state.step !== 'choose' || state.autoResolved || !requiredConnectors.length) return;
    if (autoResolveRanRef.current) return;

    const autoMap: Record<string, string> = {};
    for (const rc of requiredConnectors) {
      // Skip connectors the user has already manually configured
      if (manualSelectionsRef.current.has(rc.activeName)) continue;
      const matches = liveCredentials.filter((c) => c.service_type === rc.activeName);
      if (matches.length === 1) {
        autoMap[rc.activeName] = matches[0]!.id;
      } else {
        // Zero or multiple matches — can't fully auto-resolve
        return;
      }
    }
    // All non-manual connectors matched exactly one credential
    autoResolveRanRef.current = true;
    for (const [name, id] of Object.entries(autoMap)) {
      wizard.setConnectorCredential(name, id);
    }
    wizard.setAutoResolved(true);
  }, [requiredConnectors, liveCredentials, state.step, state.autoResolved, wizard]);

  const completedSteps = useMemo<Set<AdoptWizardStep>>(() => {
    const completed = new Set<AdoptWizardStep>();
    const currentIndex = ADOPT_STEP_META[state.step].index;
    for (const step of ADOPT_STEPS) {
      if (ADOPT_STEP_META[step].index < currentIndex) completed.add(step);
    }
    if (state.created) completed.add('create');
    return completed;
  }, [state.step, state.created]);

  // ── Safety scan ──

  const safetyScan = useMemo<ScanResult | null>(() => {
    if (!state.draft) return null;
    return scanPersonaDraft(state.draft);
  }, [state.draft]);

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

  // Wrapped credential setters that track manual selections
  const setConnectorCredentialManual = useCallback((connectorName: string, credentialId: string) => {
    manualSelectionsRef.current.add(connectorName);
    wizard.setConnectorCredential(connectorName, credentialId);
  }, [wizard.setConnectorCredential]);

  const clearConnectorCredentialManual = useCallback((connectorName: string) => {
    manualSelectionsRef.current.add(connectorName);
    wizard.clearConnectorCredential(connectorName);
  }, [wizard.clearConnectorCredential]);

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

  // ── Auto-adoption helpers ──

  const quickAdoptingRef = useRef(false);
  const quickAdoptPendingRef = useRef(false);

  const quickAdopt = useCallback(() => {
    if (quickAdoptingRef.current) return;

    const validation = validateVariables(adoptionRequirements, state.variableValues);
    if (!validation.valid) {
      wizard.goToStep('tune');
      wizard.setError(`Fill required fields before quick adopt: ${validation.missing.join(', ')}`);
      return;
    }

    quickAdoptingRef.current = true;
    quickAdoptPendingRef.current = true;
    wizard.goToStep('tune');
  }, [wizard, async, adoptionRequirements, state.variableValues]);

  useEffect(() => {
    if (!quickAdoptPendingRef.current || state.step !== 'tune') return;
    quickAdoptPendingRef.current = false;
    void async.startTransform().finally(() => {
      quickAdoptingRef.current = false;
    });
  }, [state.step, async.startTransform]);

  const enterFullWizard = useCallback(() => {
    wizard.setAutoResolved(false);
  }, [wizard]);

  // ── Draft recovery ──

  const saveDraftToStore = useCallback(() => {
    // Only save if past the first step or has meaningful connector progress
    if (state.step === 'choose' && Object.keys(state.connectorCredentialMap).length === 0) return;
    // Don't save if already created
    if (state.created) return;

    setAdoptionDraft({
      reviewId: state.reviewId,
      templateName: state.templateName,
      step: state.step,
      connectorSwaps: { ...state.connectorSwaps },
      connectorCredentialMap: { ...state.connectorCredentialMap },
      variableValues: { ...state.variableValues },
      savedAt: Date.now(),
    });
  }, [state, setAdoptionDraft]);

  // Clear draft when persona is successfully created
  useEffect(() => {
    if (state.created) {
      setAdoptionDraft(null);
    }
  }, [state.created, setAdoptionDraft]);

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
      verification,
      safetyScan,
      setConnectorCredential: setConnectorCredentialManual,
      clearConnectorCredential: clearConnectorCredentialManual,
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
      quickAdopt,
      enterFullWizard,
      saveDraftToStore,
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
      setConnectorCredentialManual,
      clearConnectorCredentialManual,
      async,
      handleNext,
      handleCredentialCreated,
      handleSkipQuestions,
      updateDraft,
      quickAdopt,
      enterFullWizard,
      saveDraftToStore,
    ],
  );

  return <AdoptionWizardCtx.Provider value={value}>{children}</AdoptionWizardCtx.Provider>;
}
